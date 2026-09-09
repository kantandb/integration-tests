# Validation errors use the public error envelope.
POST {{base_url}}/
Content-Type: application/json
{
  "name": "Bad"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_name"
jsonpath "$.error.message" == "Database name is invalid"

POST {{base_url}}/
Content-Type: text/plain
{
  "name": "e2e"
}
HTTP 415
[Asserts]
jsonpath "$.error.code" == "unsupported_media_type"

POST {{base_url}}/missing/
Content-Type: application/json
{}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "database_not_found"

GET {{base_url}}/missing/01950000-0000-7000-8000-000000000001
HTTP 404
[Asserts]
jsonpath "$.error.code" == "document_not_found"

DELETE {{base_url}}/missing/not-an-id
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_id"


# Routing errors use the same envelope.
GET {{base_url}}/missing/route/extra
HTTP 404
[Asserts]
jsonpath "$.error.code" == "route_not_found"

PATCH {{base_url}}/
HTTP 405
[Asserts]
jsonpath "$.error.code" == "method_not_allowed"
