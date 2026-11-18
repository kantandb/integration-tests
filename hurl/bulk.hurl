# Create source and indexed target databases.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}-bulk-source"
}
HTTP 201

POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}-bulk-target",
  "indices": [
    {
      "name": "name",
      "path": "/name"
    }
  ]
}
HTTP 201


# Export source documents as NDJSON.
POST {{base_url}}/db/{{database}}-bulk-source
Content-Type: application/json
{
  "name": "first",
  "rank": 1
}
HTTP 201
[Captures]
bulk_first_id: jsonpath "$.id"

POST {{base_url}}/db/{{database}}-bulk-source
Content-Type: application/json
{
  "name": "second",
  "rank": 2
}
HTTP 201
[Captures]
bulk_second_id: jsonpath "$.id"

GET {{base_url}}/bulk/{{database}}-bulk-source
HTTP 200
[Captures]
bulk_body: body replaceRegex /\n$/ ""
[Asserts]
header "Content-Type" == "application/x-ndjson"
header "Cache-Control" == "no-store"
body contains "{\"name\":\"first\",\"rank\":1}\n"
body contains "{\"name\":\"second\",\"rank\":2}\n"


# Import values with new IDs and rebuilt indices.
POST {{base_url}}/bulk/{{database}}-bulk-target
Content-Type: application/x-ndjson; charset=utf-8
```
{{bulk_body}}
```
HTTP 200
[Asserts]
jsonpath "$.success" == true
body == "{\"success\":true,\"error\":{}}"

QUERY {{base_url}}/db/{{database}}-bulk-target
Content-Type: application/json
{
  "index": "name",
  "value": "first"
}
HTTP 200
[Captures]
bulk_target_first_id: jsonpath "$.documents[0].id"
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" != "{{bulk_first_id}}"
jsonpath "$.documents[0].id" != "{{bulk_second_id}}"

GET {{base_url}}/db/{{database}}-bulk-target/{{bulk_target_first_id}}
HTTP 200
[Asserts]
header "ETag" matches /^"[0-9a-f]{32}"$/
jsonpath "$.name" == "first"
jsonpath "$.rank" == 1

QUERY {{base_url}}/db/{{database}}-bulk-target
Content-Type: application/json
{
  "index": "name",
  "value": "second"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0].id" != "{{bulk_first_id}}"
jsonpath "$.documents[0].id" != "{{bulk_second_id}}"

GET {{base_url}}/bulk/{{database}}-bulk-target
HTTP 200
[Asserts]
header "Content-Type" == "application/x-ndjson"
header "Cache-Control" == "no-store"
body contains "{\"name\":\"first\",\"rank\":1}\n"
body contains "{\"name\":\"second\",\"rank\":2}\n"


# A malformed import is rejected atomically.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}-bulk-invalid"
}
HTTP 201

POST {{base_url}}/bulk/{{database}}-bulk-invalid
Content-Type: application/x-ndjson
```raw
{"name":"valid"}
[]
```
HTTP 400
[Asserts]
jsonpath "$.success" == false
jsonpath "$.error.code" == "invalid_document"
jsonpath "$.error.line" == 2

QUERY {{base_url}}/db/{{database}}-bulk-invalid
Content-Type: application/json
{}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 0


# Validate common request failures.
POST {{base_url}}/bulk/{{database}}-bulk-invalid
Content-Type: application/json
{}
HTTP 415
[Asserts]
jsonpath "$.success" == false
jsonpath "$.error.code" == "unsupported_media_type"

POST {{base_url}}/bulk/{{database}}-bulk-invalid
Content-Type: application/x-ndjson
HTTP 400
[Asserts]
jsonpath "$.success" == false
jsonpath "$.error.code" == "invalid_document"

GET {{base_url}}/bulk/{{database}}-bulk-missing
HTTP 404
[Asserts]
jsonpath "$.success" == false
jsonpath "$.error.code" == "database_not_found"


# Clean up bulk state.
DELETE {{base_url}}/db/{{database}}-bulk-source
HTTP 204

DELETE {{base_url}}/db/{{database}}-bulk-target
HTTP 204

DELETE {{base_url}}/db/{{database}}-bulk-invalid
HTTP 204
