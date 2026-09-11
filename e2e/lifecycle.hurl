# The server starts with no databases.
GET {{base_url}}/
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0


# Create a uniquely named database.
POST {{base_url}}/
Content-Type: application/json; charset=utf-8
{
  "name": "{{database}}",
  "indexes": [
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
header "Location" == "/{{database}}"
jsonpath "$.name" == "{{database}}"
jsonpath "$.indexes" count == 3
jsonpath "$.indexes[0].name" == "email"
jsonpath "$.indexes[0].path" == "/email"
jsonpath "$.indexes[1].name" == "active"
jsonpath "$.indexes[1].path" == "/active"
jsonpath "$.indexes[2].name" == "score"
jsonpath "$.indexes[2].path" == "/score"


# Find the database through the paginated list.
GET {{base_url}}/?limit=1
HTTP 200
[Captures]
database_cursor: jsonpath "$.databases[0]"
[Asserts]
jsonpath "$.databases" count == 1
jsonpath "$.databases[0]" == "{{database}}"

GET {{base_url}}/?limit=1&cursor={{database_cursor}}
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0


# Create two documents.
POST {{base_url}}/{{database}}/
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
header "Location" == "/{{database}}/{{first_id}}"
header "ETag" matches /^"[0-9a-f]{32}"$/
jsonpath "$.id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

POST {{base_url}}/{{database}}/
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
header "Location" == "/{{database}}/{{second_id}}"
header "ETag" matches /^"[0-9a-f]{32}"$/
jsonpath "$.id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/


# Page through document IDs.
GET {{base_url}}/{{database}}?limit=1
HTTP 200
[Captures]
document_cursor: jsonpath "$.cursor"
first_listed: jsonpath "$.documents[0]"
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
jsonpath "$.cursor" != ""

GET {{base_url}}/{{database}}?limit=1&cursor={{document_cursor}}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" matches /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
jsonpath "$.documents[0]" != "{{first_listed}}"
jsonpath "$.cursor" == ""


# Query indexed values with an opaque cursor.
GET {{base_url}}/{{database}}?index=active&value=true&limit=1
HTTP 200
[Captures]
active_cursor: jsonpath "$.cursor"
active_first: jsonpath "$.documents[0]"
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.cursor" != ""

GET {{base_url}}/{{database}}?index=active&value=true&limit=1&cursor={{active_cursor}}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" != "{{active_first}}"
jsonpath "$.cursor" == ""

GET {{base_url}}/{{database}}?index=email&value=%22alice%40example.com%22
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{first_id}}"
jsonpath "$.cursor" == ""


# Query indexed comparisons in value order and page with an equivalent numeric value.
GET {{base_url}}/{{database}}?index=score&op=ge&value=10&limit=1
HTTP 200
[Captures]
score_cursor: jsonpath "$.cursor"
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{second_id}}"
jsonpath "$.cursor" != ""

GET {{base_url}}/{{database}}?index=score&op=gt&value=10&limit=1&cursor={{score_cursor}}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

GET {{base_url}}/{{database}}?index=score&op=ge&value=1e1&limit=1&cursor={{score_cursor}}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{first_id}}"
jsonpath "$.cursor" == ""

GET {{base_url}}/{{database}}?index=score&op=lt&value=20
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{second_id}}"
jsonpath "$.cursor" == ""

GET {{base_url}}/{{database}}?index=score&op=le&value=10
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{second_id}}"
jsonpath "$.cursor" == ""

GET {{base_url}}/{{database}}?index=score&op=gt&value=10
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{first_id}}"
jsonpath "$.cursor" == ""


# Read and replace the first document.
GET {{base_url}}/{{database}}/{{first_id}}
HTTP 200
[Asserts]
header "ETag" == "{{first_etag}}"
jsonpath "$.name" == "first"
jsonpath "$.active" == true
jsonpath "$.nested.a" == 1

PUT {{base_url}}/{{database}}/{{first_id}}
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

GET {{base_url}}/{{database}}?index=email&value=%22alice%40example.com%22
HTTP 200
[Asserts]
jsonpath "$.documents" count == 0
jsonpath "$.cursor" == ""

GET {{base_url}}/{{database}}?index=active&value=true
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{second_id}}"
jsonpath "$.cursor" == ""


# Reject a stale write without changing the document.
PUT {{base_url}}/{{database}}/{{first_id}}
Content-Type: application/json
If-Match: {{first_etag}}
{
  "name": "stale"
}
HTTP 412
[Asserts]
jsonpath "$.error.code" == "precondition_failed"
jsonpath "$.error.message" == "If-Match precondition failed"

GET {{base_url}}/{{database}}/{{first_id}}
HTTP 200
[Asserts]
header "ETag" == "{{replaced_etag}}"
jsonpath "$.name" == "replacement"


# Apply both patch formats.
PATCH {{base_url}}/{{database}}/{{first_id}}
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

GET {{base_url}}/{{database}}?index=active&value=false
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{first_id}}"
jsonpath "$.cursor" == ""

PATCH {{base_url}}/{{database}}/{{first_id}}
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
DELETE {{base_url}}/{{database}}/{{first_id}}
If-Match: {{patched_etag}}
HTTP 204

DELETE {{base_url}}/{{database}}/{{second_id}}
If-Match: *
HTTP 204

GET {{base_url}}/{{database}}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 0
jsonpath "$.cursor" == ""


# Delete the database and confirm it is gone.
DELETE {{base_url}}/{{database}}
HTTP 204

GET {{base_url}}/{{database}}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "database_not_found"

GET {{base_url}}/
HTTP 200
[Asserts]
jsonpath "$.databases" count == 0
