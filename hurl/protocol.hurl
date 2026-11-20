# Keep protocol checks separate from CRUD state.
POST {{base_url}}/db
Content-Type: application/json
{"name":"{{database}}-protocol"}
HTTP 201

POST {{base_url}}/db/{{database}}-protocol
Content-Type: application/json
{"name":"Alice","id":"user-id","rev":"user-rev","doc":{"value":1}}
HTTP 201
[Captures]
doc_id: jsonpath "$.id"
doc_rev: header "ETag"


# Direct reads preserve user fields inside the wrapper.
QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
```
.
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].*" count == 3
jsonpath "$[0].id" == "{{doc_id}}"
jsonpath "$[0].rev" == "{{doc_rev}}"
jsonpath "$[0].doc.id" == "user-id"
jsonpath "$[0].doc.rev" == "user-rev"
jsonpath "$[0].doc.doc.value" == 1

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
```
.missing
```
HTTP 200
[Asserts]
jsonpath "$[0].doc" == null


# NDJSON keeps nulls, Booleans, and escaped newlines inside one line.
QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/x-ndjson
```
null, false, "a\nb"
```
HTTP 200
[Asserts]
header "Query-Status" == "ok"
body split "\n" count == 4
body split "\n" nth 0 jsonpath "$.doc" == null
body split "\n" nth 1 jsonpath "$.doc" == false
body split "\n" nth 2 jsonpath "$.doc" == "a\nb"


# Accept preferences and exclusions select the response format.
QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/json;q=.2, application/x-ndjson;q=.8
```
.name
```
HTTP 200
[Asserts]
header "Content-Type" == "application/x-ndjson"
header "Cache-Control" == "no-store"
header "Vary" == "Accept"
header "Query-Status" == "ok"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/json;q=0, */*
```
.name
```
HTTP 200
[Asserts]
header "Content-Type" == "application/x-ndjson"
header "Cache-Control" == "no-store"
header "Vary" == "Accept"
header "Query-Status" == "ok"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/*
```
.name
```
HTTP 200
[Asserts]
header "Content-Type" == "application/json; charset=utf-8"
header "Cache-Control" == "no-store"
header "Vary" == "Accept"
jsonpath "$[0].doc" == "Alice"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/json;q=.8, application/x-ndjson;q=.2
```
.name
```
HTTP 200
[Asserts]
header "Content-Type" == "application/json; charset=utf-8"
header "Cache-Control" == "no-store"
header "Vary" == "Accept"
jsonpath "$[0].doc" == "Alice"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/json;q=0, application/x-ndjson;q=0
```
.
```
HTTP 406
[Asserts]
jsonpath "$.error.code" == "not_acceptable"


# Empty and repeated pagination headers are invalid on both routes.
GET {{base_url}}/db
Limit:
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

GET {{base_url}}/db
Limit: -1
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

GET {{base_url}}/db
Limit: 1, 2
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

GET {{base_url}}/db
Limit: 1
Limit: 2
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

GET {{base_url}}/db
Cursor:
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

GET {{base_url}}/db
Cursor: alpha
Cursor: beta
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Limit:
```
.
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Limit: -1
```
.
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Limit: 1, 2
```
.
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Limit: 1
Limit: 2
```
.
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_limit"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Cursor:
```
.
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Cursor: alpha
Cursor: beta
```
.
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

# Repeated conditions must not mutate the document.
PUT {{base_url}}/db/{{database}}-protocol/{{doc_id}}
Content-Type: application/json
If-Match: {{doc_rev}}
If-Match: {{doc_rev}}
{}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_if_match"

GET {{base_url}}/db/{{database}}-protocol/{{doc_id}}
HTTP 200
[Asserts]
header "ETag" == "{{doc_rev}}"
jsonpath "$.name" == "Alice"


PATCH {{base_url}}/db/{{database}}-protocol/{{doc_id}}
Content-Type: application/merge-patch+json
If-Match: {{doc_rev}}
If-Match: {{doc_rev}}
{}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_if_match"

DELETE {{base_url}}/db/{{database}}-protocol/{{doc_id}}
If-Match: {{doc_rev}}
If-Match: {{doc_rev}}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_if_match"

GET {{base_url}}/db/{{database}}-protocol/{{doc_id}}
HTTP 200
[Asserts]
header "ETag" == "{{doc_rev}}"
jsonpath "$.name" == "Alice"


# A line larger than the stream buffer must arrive intact.
QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/x-ndjson
```
0, ("x" * 65536), 2
```
HTTP 200
[Asserts]
header "Query-Status" == "ok"
body split "\n" count == 4
body split "\n" nth 0 jsonpath "$.doc" == 0
body split "\n" nth 1 jsonpath "$.doc" matches /^x{65536}$/
body split "\n" nth 2 jsonpath "$.doc" == 2


# Canonical redirects preserve methods and query strings.
GET {{base_url}}/db/?x=1
HTTP 301
[Asserts]
header "Location" == "/db?x=1"

POST {{base_url}}/db/
Content-Type: application/json
{"name":"{{database}}-redirect"}
HTTP 307
[Asserts]
header "Location" == "/db"

GET {{base_url}}/db/{{database}}-redirect
HTTP 404
[Asserts]
jsonpath "$.error.code" == "database_not_found"

HEAD {{base_url}}/healthz
HTTP 405
[Asserts]
body == ""

PUT {{base_url}}/db
HTTP 405
[Asserts]
jsonpath "$.error.code" == "method_not_allowed"

GET {{base_url}}/db//invalid
HTTP 404
[Asserts]
jsonpath "$.error.code" == "route_not_found"


GET {{base_url}}/db/./invalid
HTTP 404
[Asserts]
jsonpath "$.error.code" == "route_not_found"

GET {{base_url}}/db/../healthz
HTTP 404
[Asserts]
jsonpath "$.error.code" == "route_not_found"


# inputs keeps the metadata of the document that began evaluation.
POST {{base_url}}/db/{{database}}-protocol
Content-Type: application/json
{"name":1}
HTTP 201

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
```
[., inputs] | length
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].id" == "{{doc_id}}"
jsonpath "$[0].rev" == "{{doc_rev}}"
jsonpath "$[0].doc" == 2


# Lookahead errors invalidate the whole buffered page and its cursor.
QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Limit: 1
```
.name | startswith("A")
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "query_runtime"
header "Cursor" not exists

QUERY {{base_url}}/db/{{database}}-protocol
Content-Type: text/plain
Accept: application/x-ndjson
Limit: 1
```
.name | startswith("A")
```
HTTP 200
[Asserts]
header "Trailer" contains "Cursor"
header "Query-Status" == "error"
header "Cursor" not exists
body split "\n" count == 2
body split "\n" nth 0 jsonpath "$.doc" == true

DELETE {{base_url}}/db/{{database}}-protocol
HTTP 204
