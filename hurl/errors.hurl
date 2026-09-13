# Validation errors use the public error envelope.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "Bad"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_name"
jsonpath "$.error.message" == "Database name is invalid"

POST {{base_url}}/db
Content-Type: text/plain
{
  "name": "hurl"
}
HTTP 415
[Asserts]
jsonpath "$.error.code" == "unsupported_media_type"

POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}",
  "indexes": null
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_request"


# Query validation distinguishes malformed and missing indexes.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}",
  "indexes": [
    {
      "name": "active",
      "path": "/active"
    }
  ]
}
HTTP 201

GET {{base_url}}/db/{{database}}?index=active
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

GET {{base_url}}/db/{{database}}?op=eq
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

GET {{base_url}}/db/{{database}}?index=active&op=bad&value=true
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

GET {{base_url}}/db/{{database}}?index=active&op=lt&value=true
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

GET {{base_url}}/db/{{database}}?index=active&value=%7B%7D
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

GET {{base_url}}/db/{{database}}?index=active&index=active&value=true
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

GET {{base_url}}/db/{{database}}?unknown=true
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

GET {{base_url}}/db/{{database}}?index=missing&value=true
HTTP 404
[Asserts]
jsonpath "$.error.code" == "index_not_found"

GET {{base_url}}/db/{{database}}?index=active&value=true&cursor=bad
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"


# QUERY rejects invalid request contracts.
QUERY {{base_url}}/db/{{database}}?limit=1
Content-Type: application/json
{
  "path": "$.active",
  "value": true
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"
jsonpath "$.error.message" == "URI query parameters are not supported"

QUERY {{base_url}}/db/{{database}}
HTTP 415
[Asserts]
jsonpath "$.error.code" == "unsupported_media_type"
jsonpath "$.error.message" == "Content-Type must be application/json"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
{
  "path": "$.active",
  "value": true
}
HTTP 415
[Asserts]
jsonpath "$.error.code" == "unsupported_media_type"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "$.active"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
```
{"path":"$.active","value":true
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "$.active",
  "value": true,
  "extra": true
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "$.active",
  "value": {}
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "$.active",
  "op": "gt",
  "value": true
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "active",
  "value": true
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"
jsonpath "$.error.message" == "Path is invalid"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "$.active",
  "value": true,
  "limit": 0
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "$.active",
  "value": true,
  "cursor": "bad"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"
jsonpath "$.error.message" == "Cursor is invalid"

DELETE {{base_url}}/db/{{database}}
HTTP 204

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{
  "path": "$.active",
  "value": true
}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "database_not_found"
jsonpath "$.error.message" == "Database does not exist"


POST {{base_url}}/db/missing
Content-Type: application/json
{}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "database_not_found"

GET {{base_url}}/db/missing/01950000-0000-7000-8000-000000000001
HTTP 404
[Asserts]
jsonpath "$.error.code" == "document_not_found"

DELETE {{base_url}}/db/missing/not-an-id
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_id"


# Routing errors use the same envelope.
GET {{base_url}}/db/missing/route/extra
HTTP 404
[Asserts]
jsonpath "$.error.code" == "route_not_found"

PATCH {{base_url}}/
HTTP 405
[Asserts]
jsonpath "$.error.code" == "method_not_allowed"
