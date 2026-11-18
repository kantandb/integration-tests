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
    },
    {
      "name": "score",
      "path": "/score"
    }
  ]
}
HTTP 201
[Asserts]
header "Location" == "/db/{{database}}"
jsonpath "$.name" == "{{database}}"
jsonpath "$.indices" count == 3
jsonpath "$.indices[0].name" == "email"
jsonpath "$.indices[0].path" == "/email"
jsonpath "$.indices[1].name" == "active"
jsonpath "$.indices[1].path" == "/active"
jsonpath "$.indices[2].name" == "score"
jsonpath "$.indices[2].path" == "/score"


# Find the database through the paginated list.
GET {{base_url}}/db?limit=1
HTTP 200
[Captures]
database_cursor: jsonpath "$.databases[0]"
[Asserts]
jsonpath "$.databases" count == 1
jsonpath "$.databases[0]" == "{{database}}"

GET {{base_url}}/db?limit=1&cursor={{database_cursor}}
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0


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
[Asserts]
header "Location" == "/db/{{database}}/{{second_id}}"
header "ETag" matches /^"[0-9a-f]{32}"$/
jsonpath "$.id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/


# Read database information without listing documents.
GET {{base_url}}/db/{{database}}
HTTP 200
[Asserts]
header "Accept-Query" == "application/json"
jsonpath "$.name" == "{{database}}"
jsonpath "$.indices" count == 3
jsonpath "$.doc_count" == 2
jsonpath "$.documents" not exists


# Page through full documents.
QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "limit": 1
}
HTTP 200
[Captures]
document_cursor: jsonpath "$.cursor"
first_listed: jsonpath "$.documents[0].id"
listed_rev: jsonpath "$.documents[0].rev"
[Asserts]
header "Accept-Query" == "application/json"
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
jsonpath "$.cursor" != ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "limit": 1,
  "cursor": "{{document_cursor}}"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
jsonpath "$.documents[0].id" != "{{first_listed}}"
jsonpath "$.documents[0].doc.name" == "second"
jsonpath "$.documents[0].rev" matches /^[0-9a-f]{32}$/
jsonpath "$.cursor" == ""


# Query indexed values with an opaque cursor.
QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "active",
  "value": true,
  "limit": 1
}
HTTP 200
[Captures]
active_cursor: jsonpath "$.cursor"
active_first: jsonpath "$.documents[0].id"
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.cursor" != ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "active",
  "value": true,
  "limit": 1,
  "cursor": "{{active_cursor}}"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" != "{{active_first}}"
jsonpath "$.cursor" == ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "email",
  "value": "alice@example.com"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{first_id}}"
jsonpath "$.documents[0].doc.email" == "alice@example.com"
jsonpath "$.documents[0].rev" == "{{listed_rev}}"
jsonpath "$.cursor" == ""


# Query indexed comparisons in value order and page with an equivalent numeric value.
QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "score",
  "op": "ge",
  "value": 10,
  "limit": 1
}
HTTP 200
[Captures]
score_cursor: jsonpath "$.cursor"
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{second_id}}"
jsonpath "$.cursor" != ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "score",
  "op": "gt",
  "value": 10,
  "limit": 1,
  "cursor": "{{score_cursor}}"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "score",
  "op": "ge",
  "value": 10,
  "limit": 1,
  "cursor": "{{score_cursor}}"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{first_id}}"
jsonpath "$.cursor" == ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "score",
  "op": "lt",
  "value": 20
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{second_id}}"
jsonpath "$.cursor" == ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "score",
  "op": "le",
  "value": 10
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{second_id}}"
jsonpath "$.cursor" == ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "score",
  "op": "gt",
  "value": 10
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{first_id}}"
jsonpath "$.cursor" == ""


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
If-Match: "{{listed_rev}}"
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
Content-Type: application/json
{
  "index": "email",
  "value": "alice@example.com"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 0
jsonpath "$.cursor" == ""

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "index": "active",
  "value": true
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{second_id}}"
jsonpath "$.cursor" == ""


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
Content-Type: application/json
{
  "index": "active",
  "value": false
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" == "{{first_id}}"
jsonpath "$.cursor" == ""

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

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 0
jsonpath "$.cursor" == ""


# Confirm database counts follow document deletion.
GET {{base_url}}/db/{{database}}
HTTP 200
[Asserts]
jsonpath "$.name" == "{{database}}"
jsonpath "$.indices" count == 3
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
