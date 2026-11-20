# The root describes the service.
GET {{base_url}}/
HTTP 200
[Asserts]
jsonpath "$.name" == "KantanDB"
jsonpath "$.version" isString
jsonpath "$.version" != ""


# The server starts with no databases.
GET {{base_url}}/db
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0


# Create a uniquely named database.
POST {{base_url}}/db
Content-Type: application/json; charset=utf-8
{
  "name": "{{database}}",
  "indices": [
    {
      "name": "email",
      "path": "/email"
    },
    {
      "name": "active",
      "path": "/active"
    }
  ]
}
HTTP 201
[Asserts]
header "Location" == "/db/{{database}}"
jsonpath "$.name" == "{{database}}"
jsonpath "$.indices" count == 2
jsonpath "$.indices[0].name" == "email"
jsonpath "$.indices[0].path" == "/email"
jsonpath "$.indices[1].name" == "active"
jsonpath "$.indices[1].path" == "/active"


# Create another database to force a second page.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}-next"
}
HTTP 201


# Find the database through the paginated list.
GET {{base_url}}/db
Limit: 1
HTTP 200
[Captures]
database_cursor: header "Cursor"
[Asserts]
jsonpath "$.databases" count == 1
jsonpath "$.databases[0]" == "{{database}}"
header "Cursor" == "{{database}}"

GET {{base_url}}/db
Limit: 1
Cursor: {{database_cursor}}
HTTP 200
[Asserts]
jsonpath "$.databases" count == 1
jsonpath "$.databases[0]" == "{{database}}-next"
header "Cursor" not exists

GET {{base_url}}/db
Cursor: {{database}}-next
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0
header "Cursor" not exists

DELETE {{base_url}}/db/{{database}}-next
HTTP 204


# Create two documents.
POST {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "name": "first",
  "email": "alice@example.com",
  "active": true,
  "score": 20,
  "nested": {
    "a": 1
  }
}
HTTP 201
[Captures]
first_id: jsonpath "$.id"
first_etag: header "ETag"
[Asserts]
header "Location" == "/db/{{database}}/{{first_id}}"
header "ETag" matches /^"[0-9a-f]{32}"$/
jsonpath "$.id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

POST {{base_url}}/db/{{database}}
Content-Type: application/json; charset=utf-8
{
  "name": "second",
  "email": "bob@example.com",
  "active": true,
  "score": 10
}
HTTP 201
[Captures]
second_id: jsonpath "$.id"
second_etag: header "ETag"
[Asserts]
header "Location" == "/db/{{database}}/{{second_id}}"
header "ETag" matches /^"[0-9a-f]{32}"$/
jsonpath "$.id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/


# Read database information without listing documents.
GET {{base_url}}/db/{{database}}
HTTP 200
[Asserts]
header "Accept-Query" == "text/plain"
jsonpath "$.name" == "{{database}}"
jsonpath "$.indices" count == 2
jsonpath "$.doc_count" == 2
jsonpath "$.documents" not exists


# Read documents with their IDs and revisions.
QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
.
```
HTTP 200
[Asserts]
jsonpath "$" count == 2
jsonpath "$[0].doc.name" == "first"
jsonpath "$[1].doc.name" == "second"
jsonpath "$[0].id" == "{{first_id}}"
jsonpath "$[0].rev" == "{{first_etag}}"
jsonpath "$[1].id" == "{{second_id}}"
jsonpath "$[1].rev" == "{{second_etag}}"
jsonpath "$[0].doc.id" not exists
jsonpath "$[0].doc.rev" not exists


# Read and replace the first document.
GET {{base_url}}/db/{{database}}/{{first_id}}
HTTP 200
[Asserts]
header "ETag" == "{{first_etag}}"
jsonpath "$.name" == "first"
jsonpath "$.active" == true
jsonpath "$.nested.a" == 1

PUT {{base_url}}/db/{{database}}/{{first_id}}
Content-Type: application/json
If-Match: {{first_etag}}
{
  "name": "replacement",
  "count": 1
}
HTTP 200
[Captures]
replaced_etag: header "ETag"
[Asserts]
header "ETag" != "{{first_etag}}"
jsonpath "$.name" == "replacement"
jsonpath "$.count" == 1

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
select(.email == "alice@example.com")
```
HTTP 200
[Asserts]
jsonpath "$" count == 0

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
select(.active == true) | .name
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc" == "second"
jsonpath "$[0].id" == "{{second_id}}"
jsonpath "$[0].rev" == "{{second_etag}}"


# Reject a stale write without changing the document.
PUT {{base_url}}/db/{{database}}/{{first_id}}
Content-Type: application/json
If-Match: {{first_etag}}
{
  "name": "stale"
}
HTTP 412
[Asserts]
jsonpath "$.error.code" == "precondition_failed"
jsonpath "$.error.message" == "If-Match precondition failed"

GET {{base_url}}/db/{{database}}/{{first_id}}
HTTP 200
[Asserts]
header "ETag" == "{{replaced_etag}}"
jsonpath "$.name" == "replacement"


# Apply both patch formats.
PATCH {{base_url}}/db/{{database}}/{{first_id}}
Content-Type: application/merge-patch+json; charset=utf-8
If-Match: {{replaced_etag}}
{
  "name": "merged",
  "active": false,
  "enabled": true
}
HTTP 200
[Captures]
merged_etag: header "ETag"
[Asserts]
header "ETag" != "{{replaced_etag}}"
jsonpath "$.name" == "merged"
jsonpath "$.count" == 1
jsonpath "$.active" == false
jsonpath "$.enabled" == true

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
select(.active == false) | .name
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc" == "merged"
jsonpath "$[0].rev" == "{{merged_etag}}"

PATCH {{base_url}}/db/{{database}}/{{first_id}}
Content-Type: application/json-patch+json
If-Match: {{merged_etag}}
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
patched_etag: header "ETag"
[Asserts]
header "ETag" != "{{merged_etag}}"
jsonpath "$.name" == "patched"
jsonpath "$.items" count == 2
jsonpath "$.items[1]" == 2


# Delete both documents and confirm the list is empty.
DELETE {{base_url}}/db/{{database}}/{{first_id}}
If-Match: {{patched_etag}}
HTTP 204

DELETE {{base_url}}/db/{{database}}/{{second_id}}
If-Match: *
HTTP 204

GET {{base_url}}/db/{{database}}/{{first_id}}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "document_not_found"

GET {{base_url}}/db/{{database}}/{{second_id}}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "document_not_found"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
.
```
HTTP 200
[Asserts]
body == "[]"


# Confirm database counts follow document deletion.
GET {{base_url}}/db/{{database}}
HTTP 200
[Asserts]
jsonpath "$.name" == "{{database}}"
jsonpath "$.indices" count == 2
jsonpath "$.doc_count" == 0


# Delete the database and confirm it is gone.
DELETE {{base_url}}/db/{{database}}
HTTP 204

GET {{base_url}}/db/{{database}}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "database_not_found"

GET {{base_url}}/db
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0
