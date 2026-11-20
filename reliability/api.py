"""Executable-level tests for restarts, streaming, cancellation, and limits."""

import base64
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
JSON = {"Content-Type": "application/json"}
NDJSON = {"Content-Type": "application/x-ndjson"}
QUERY = {"Content-Type": "text/plain"}


class API(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="kantan-api-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        key = self.path / "key"
        key.write_bytes(base64.b64encode(os.urandom(32)))
        key.chmod(0o600)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.log = (self.path / "server.log").open("w+")
        self.addCleanup(self.log.close)
        self.addCleanup(self.stop)
        self.start()
        self.request("POST", "/db", {"name": "db", "indices": [{"name": "score", "path": "/score"}]}, JSON, 201)

    def start(self, *flags):
        self.process = subprocess.Popen([
            str(ROOT / "server-go/kantan"), "-addr", f"127.0.0.1:{self.port}",
            "-data", str(self.path / "db"), "-key-file", str(self.path / "key"),
            "-max-body-bytes", "256", "-bulk-max-bytes", "512",
            "-bulk-max-documents", "3", "-bulk-max-batch-bytes", "4096",
            "-bulk-timeout", "500ms", *flags,
        ], stdout=self.log, stderr=self.log)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and self.process.poll() is None:
            try:
                self.request("GET", "/healthz")
                return
            except (OSError, http.client.HTTPException):
                time.sleep(0.02)
        self.log.flush()
        self.fail((self.path / "server.log").read_text())

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
                self.fail("server did not stop")

    def request(self, method, path, body=None, headers=None, status=200, code=None):
        if isinstance(body, dict):
            body = json.dumps(body, separators=(",", ":"))
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            data = response.read()
            self.assertIn(response.status, status if isinstance(status, tuple) else (status,), data[:500])
            value = json.loads(data) if data else None
            if code:
                self.assertEqual(value["error"]["code"], code)
            return value, {name.lower(): value for name, value in response.getheaders()}
        finally:
            connection.close()

    def count(self):
        return self.request("GET", "/db/db")[0]["doc_count"]

    def partial_import(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.putrequest("POST", "/db/db")
        connection.putheader("Content-Type", "application/x-ndjson")
        connection.putheader("Content-Length", "100")
        connection.endheaders()
        connection.send(b'{"score":99}\n')
        return connection

    def await_busy(self):
        # Wait for the partial request to occupy the slot before asserting rejection.
        deadline = time.monotonic() + 0.4
        while time.monotonic() < deadline:
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
            try:
                connection.request("POST", "/db/db", "{}", NDJSON)
                response = connection.getresponse()
                value = json.loads(response.read())
                if response.status == 429:
                    self.assertEqual(value["error"]["code"], "bulk_limit")
                    return self.count()
                self.assertEqual(response.status, 200)
            finally:
                connection.close()
        self.fail("partial import never occupied the bulk slot")

    def test_limits_and_framing(self):
        # Exercise exact byte boundaries with small configured limits.
        exact = '{"value":"' + "x" * (256 - len('{"value":""}')) + '"}'
        self.request("POST", "/db/db", exact, JSON, 201)
        for method, path in [("POST", "/db/db"), ("PUT", "/db/db/missing")]:
            if method == "PUT":
                created, _ = self.request("POST", "/db/db", {}, JSON, 201)
                path = f'/db/db/{created["id"]}'
            self.request(method, path, exact + " ", JSON, 413, "content_too_large")
        created, rev = self.request("POST", "/db/db", exact, JSON, 201)
        path = f'/db/db/{created["id"]}'
        self.request("PATCH", path, {"extra": "x"}, {"Content-Type": "application/merge-patch+json"}, 413, "content_too_large")
        self.assertEqual(self.request("GET", path)[1]["etag"], rev["etag"])
        self.request("POST", "/db/db", "{}\r\n{\"value\":1}", NDJSON)
        self.request("POST", "/db/db", "{}\n" * 3, NDJSON)
        line = '{"value":"' + "x" * (255 - len('{"value":""}')) + '"}\n'
        self.request("POST", "/db/db", line * 2, NDJSON)
        before = self.count()
        for body, code, line_number in [
            ("{}\n" * 4, "content_too_large", 4),
            (line * 2 + "{}\n", "content_too_large", None),
            ("{}\n\n", "invalid_document", 2),
            ("{}\n[]", "invalid_document", 2),
        ]:
            value, _ = self.request("POST", "/db/db", body, NDJSON, 413 if code == "content_too_large" else 400, code)
            self.assertFalse(value["success"])
            if line_number:
                self.assertEqual(value["error"]["line"], line_number)
            self.assertEqual(self.count(), before)

    def test_batch_limit_rollback(self):
        self.request("POST", "/db/db", {"score": 1}, JSON, 201)
        self.stop()
        self.start("-bulk-max-batch-bytes", "1")
        self.request("POST", "/db/db", '{"score":2}\n', NDJSON, 413, "content_too_large")
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.request("QUERY", "/db/db", "select(.score == 2)", QUERY)[0], [])

    def test_bulk_timeout_and_cancel(self):
        connection = self.partial_import()
        try:
            before = self.await_busy()
            response = connection.getresponse()
            self.assertEqual(response.status, 503)
            self.assertEqual(json.loads(response.read())["error"]["code"], "bulk_timeout")
        finally:
            connection.close()
        self.assertEqual(self.count(), before)
        self.request("POST", "/db/db", "{}", NDJSON)
        connection = self.partial_import()
        try:
            before = self.await_busy()
        finally:
            connection.close()
        # Cancellation must release capacity without committing the valid prefix.
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            value, _ = self.request("POST", "/db/db", "{}", NDJSON, (200, 429))
            if value["success"]:
                break
            self.assertEqual(value["error"]["code"], "bulk_limit")
            time.sleep(0.02)
        else:
            self.fail("bulk capacity did not recover")
        self.assertEqual(self.count(), before + 1)
        self.assertEqual(self.request("QUERY", "/db/db", "select(.score == 99)", QUERY)[0], [])

    def test_queries_overlap_and_cancel(self):
        self.request("POST", "/db/db", {}, JSON, 201)
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        response = None
        try:
            connection.request("QUERY", "/db/db", "1, (def loop: loop; loop)",
                               {**QUERY, "Accept": "application/x-ndjson"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.readline())["doc"], 1)
            # The first response remains open and cannot complete normally.
            rows, _ = self.request("QUERY", "/db/db", "2", QUERY)
            self.assertEqual(rows[0]["doc"], 2)
        finally:
            if response:
                response.close()
            connection.close()
        self.assertEqual(self.request("QUERY", "/db/db", ".", QUERY)[0][0]["doc"], {})

    def test_query_output_limit(self):
        self.stop()
        self.start("-max-body-bytes", "1048576")
        self.request("POST", "/db/db", {}, JSON, 201)
        self.request("QUERY", "/db/db", "." + " " * 65535, QUERY)
        self.request("QUERY", "/db/db", "." + " " * 65536, QUERY, 413, "content_too_large")
        self.request("QUERY", "/db/db", '"x" * 8388608', QUERY, 503, "query_limit")
        streamed, _ = self.request("QUERY", "/db/db", '"x" * 8388608',
                                   {**QUERY, "Accept": "application/x-ndjson"})
        self.assertEqual(len(streamed["doc"]), 8388608)
        self.request("QUERY", "/db/db", "def loop: loop; loop", QUERY, 503, "query_timeout")
        self.assertEqual(self.request("QUERY", "/db/db", ".", QUERY)[0][0]["doc"], {})

    def test_restart_preserves_state(self):
        first, rev = self.request("POST", "/db/db", {"score": 7}, JSON, 201)
        second, _ = self.request("POST", "/db/db", {"score": 8}, JSON, 201)
        rows, page = self.request("QUERY", "/db/db", ".", {**QUERY, "Limit": "1"})
        cursor = page["cursor"]
        self.stop()
        self.start()
        self.assertEqual(self.request("GET", f'/db/db/{first["id"]}')[1]["etag"], rev["etag"])
        rows, _ = self.request("QUERY", "/db/db", ".", {**QUERY, "Cursor": cursor})
        self.assertEqual([row["id"] for row in rows], [second["id"]])
        rows, _ = self.request("QUERY", "/db/db", "select(.score == 7)", QUERY)
        self.assertEqual(rows[0]["id"], first["id"])
        _, updated = self.request("PATCH", f'/db/db/{first["id"]}', {"score": 9},
                                  {"Content-Type": "application/merge-patch+json", "If-Match": rev["etag"]})
        self.request("DELETE", f'/db/db/{second["id"]}', status=204)
        self.stop()
        self.start()
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.request("QUERY", "/db/db", "select(.score == 7)", QUERY)[0], [])
        rows, _ = self.request("QUERY", "/db/db", "select(.score == 9)", QUERY)
        self.assertEqual((rows[0]["id"], rows[0]["rev"]), (first["id"], updated["etag"]))
        self.request("GET", f'/db/db/{second["id"]}', status=404, code="document_not_found")


if __name__ == "__main__":
    subprocess.run(["mise", "run", "build"], cwd=ROOT / "server-go", check=True)
    unittest.main(verbosity=2)
