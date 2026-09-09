# The server starts with no databases.
GET {{base_url}}/
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0


# Create and list a database.
POST {{base_url}}/
Content-Type: application/json
{
  "name": "e2e"
}
HTTP 201
[Asserts]
header "Location" == "/e2e"
jsonpath "$.name" == "e2e"

GET {{base_url}}/
HTTP 200
[Asserts]
jsonpath "$.databases" count == 1
jsonpath "$.databases[0]" == "e2e"


# Create and read a document.
POST {{base_url}}/e2e/
Content-Type: application/json
{
  "name": "first",
  "active": true,
  "nested": {
    "a": 1
  }
}
HTTP 201
[Captures]
doc_id: jsonpath "$.id"
etag_created: header "ETag"
[Asserts]
header "Location" == "/e2e/{{doc_id}}"
jsonpath "$.id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

GET {{base_url}}/e2e/{{doc_id}}
HTTP 200
[Asserts]
header "ETag" == "{{etag_created}}"
jsonpath "$.name" == "first"
jsonpath "$.active" == true
jsonpath "$.nested.a" == 1


# Replace with optimistic concurrency.
PUT {{base_url}}/e2e/{{doc_id}}
Content-Type: application/json
If-Match: {{etag_created}}
{
  "name": "second",
  "count": 1
}
HTTP 200
[Captures]
etag_replaced: header "ETag"
[Asserts]
header "ETag" != "{{etag_created}}"
jsonpath "$.name" == "second"
jsonpath "$.count" == 1


# Merge fields, then apply a JSON Patch.
PATCH {{base_url}}/e2e/{{doc_id}}
Content-Type: application/merge-patch+json
If-Match: {{etag_replaced}}
{
  "name": "merged",
  "enabled": true
}
HTTP 200
[Captures]
etag_merged: header "ETag"
[Asserts]
jsonpath "$.name" == "merged"
jsonpath "$.count" == 1
jsonpath "$.enabled" == true

PATCH {{base_url}}/e2e/{{doc_id}}
Content-Type: application/json-patch+json
If-Match: {{etag_merged}}
[
  {
    "op": "replace",
    "path": "/name",
    "value": "patched"
  },
  {
    "op": "add",
    "path": "/items",
    "value": [1, 2]
  }
]
HTTP 200
[Captures]
etag_patched: header "ETag"
[Asserts]
jsonpath "$.name" == "patched"
jsonpath "$.items" count == 2
jsonpath "$.items[1]" == 2


# Reject a stale write without changing the document.
PUT {{base_url}}/e2e/{{doc_id}}
Content-Type: application/json
If-Match: {{etag_created}}
{
  "name": "stale"
}
HTTP 412
[Asserts]
jsonpath "$.error.code" == "precondition_failed"

GET {{base_url}}/e2e/{{doc_id}}
HTTP 200
[Asserts]
header "ETag" == "{{etag_patched}}"
jsonpath "$.name" == "patched"


# Delete the document and database.
DELETE {{base_url}}/e2e/{{doc_id}}
If-Match: {{etag_patched}}
HTTP 204

GET {{base_url}}/e2e/{{doc_id}}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "document_not_found"

DELETE {{base_url}}/e2e
HTTP 204

GET {{base_url}}/
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0
