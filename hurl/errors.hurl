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
  "indices": null
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_request"


# Create a document so jq runtime errors can be tested.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}"
}
HTTP 201

POST {{base_url}}/db/{{database}}
Content-Type: application/json
{}
HTTP 201


# Reject URI parameters on database reads and queries.
GET {{base_url}}/db/{{database}}?limit=1
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"
jsonpath "$.error.message" == "URI query parameters are not supported"

QUERY {{base_url}}/db/{{database}}?limit=1
Content-Type: text/plain
```
.
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"
jsonpath "$.error.message" == "URI query parameters are not supported"


# Reject unsupported request and response formats.
QUERY {{base_url}}/db/{{database}}
HTTP 415
[Asserts]
jsonpath "$.error.code" == "unsupported_media_type"
jsonpath "$.error.message" == "Content-Type must be text/plain with UTF-8 encoding"

QUERY {{base_url}}/db/{{database}}
Content-Type: application/json
{}
HTTP 415
[Asserts]
jsonpath "$.error.code" == "unsupported_media_type"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain; charset=iso-8859-1
```
.
```
HTTP 415
[Asserts]
jsonpath "$.error.code" == "unsupported_media_type"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
Accept: text/html
```
.
```
HTTP 406
[Asserts]
jsonpath "$.error.code" == "not_acceptable"


# Distinguish invalid programs from runtime failures.
QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
. |
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
unknown_function
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_query"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
error("failed")
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "query_runtime"

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
Accept: application/x-ndjson
```
error("failed")
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "query_runtime"

DELETE {{base_url}}/db/{{database}}
HTTP 204

QUERY {{base_url}}/db/{{database}}
Content-Type: text/plain
```
.
```
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
