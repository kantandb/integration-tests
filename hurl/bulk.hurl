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


# Export wrapped documents for import.
POST {{base_url}}/db/{{database}}-bulk-source
Content-Type: application/x-ndjson
```
{"name":"first","rank":1}
{"name":"second","rank":2}
```
HTTP 200
[Asserts]
body == "{\"success\":true,\"error\":{}}"

QUERY {{base_url}}/db/{{database}}-bulk-source
Content-Type: text/plain
Accept: application/x-ndjson
```
.
```
HTTP 200
[Captures]
bulk_body: body replaceRegex /\n$/ ""
[Asserts]
header "Content-Type" == "application/x-ndjson"
header "Cache-Control" == "no-store"
header "Trailer" == "Query-Status"
header "Query-Status" == "ok"
body split "\n" count == 3
body contains "\"doc\":{\"name\":\"first\",\"rank\":1}}\n"
body contains "\"doc\":{\"name\":\"second\",\"rank\":2}}\n"


# Import the export and read the same values from the target.
POST {{base_url}}/db/{{database}}-bulk-target
Content-Type: application/x-ndjson; charset=utf-8
```
{{bulk_body}}
```
HTTP 200
[Asserts]
body == "{\"success\":true,\"error\":{}}"

GET {{base_url}}/db/{{database}}-bulk-target
HTTP 200
[Asserts]
jsonpath "$.doc_count" == 2
jsonpath "$.indices[0].name" == "name"

QUERY {{base_url}}/db/{{database}}-bulk-target
Content-Type: text/plain
Accept: application/x-ndjson
```
.
```
HTTP 200
[Asserts]
header "Content-Type" == "application/x-ndjson"
header "Query-Status" == "ok"
body split "\n" count == 3
body contains "\"doc\":{\"name\":\"first\",\"rank\":1}}\n"
body contains "\"doc\":{\"name\":\"second\",\"rank\":2}}\n"


# A malformed import does not add any documents.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}-bulk-invalid"
}
HTTP 201

POST {{base_url}}/db/{{database}}-bulk-invalid
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

GET {{base_url}}/db/{{database}}-bulk-invalid
HTTP 200
[Asserts]
jsonpath "$.doc_count" == 0


# An empty batch is invalid, but a single line is a batch.
POST {{base_url}}/db/{{database}}-bulk-invalid
Content-Type: application/x-ndjson
HTTP 400
[Asserts]
jsonpath "$.success" == false
jsonpath "$.error.code" == "invalid_document"

POST {{base_url}}/db/{{database}}-bulk-invalid
Content-Type: application/x-ndjson
```
{}
```
HTTP 200
[Asserts]
jsonpath "$.success" == true

GET {{base_url}}/db/{{database}}-bulk-invalid
HTTP 200
[Asserts]
jsonpath "$.doc_count" == 1

POST {{base_url}}/db/{{database}}-bulk-missing
Content-Type: application/x-ndjson
```
{}
```
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
