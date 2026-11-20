# Create an isolated database for jq queries.
POST {{base_url}}/db
Content-Type: application/json
{
  "name": "{{database}}-query",
  "indices": [
    {
      "name": "score",
      "path": "/score"
    }
  ]
}
HTTP 201


# Advertise QUERY support.
OPTIONS {{base_url}}/db/{{database}}-query
HTTP 204
[Asserts]
header "Accept-Query" == "text/plain"
header "Allow" == "GET, POST, QUERY, DELETE, OPTIONS"


# Create documents with varied field types.
POST {{base_url}}/db/{{database}}-query
Content-Type: application/json
{
  "score": 20,
  "products": [
    {
      "price": 5
    }
  ]
}
HTTP 201
[Captures]
score20_id: jsonpath "$.id"
score20_rev: header "ETag"

POST {{base_url}}/db/{{database}}-query
Content-Type: application/json
{
  "score": 10,
  "products": [
    {
      "price": 15
    },
    {
      "price": 8
    }
  ]
}
HTTP 201
[Captures]
score10_id: jsonpath "$.id"
score10_rev: header "ETag"

POST {{base_url}}/db/{{database}}-query
Content-Type: application/json
{
  "products": [
    {
      "price": {
        "amount": 5
      }
    }
  ],
  "items": [
    {
      "sku": "array"
    }
  ]
}
HTTP 201

POST {{base_url}}/db/{{database}}-query
Content-Type: application/json
{
  "items": {
    "0": {
      "sku": "object"
    }
  }
}
HTTP 201


# Filter nested values and project the result in document order.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain; charset=utf-8
```
.products[]?.price | numbers | select(. < 10)
```
HTTP 200
[Asserts]
header "Accept-Query" == "text/plain"
header "Cache-Control" == "no-store"
header "Vary" == "Accept"
header "Content-Type" == "application/json; charset=utf-8"
jsonpath "$" count == 2
jsonpath "$[0].doc" == 5
jsonpath "$[1].doc" == 8


# Query numeric scores in document order, not index order.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
```
.score | numbers | select(. >= 10)
```
HTTP 200
[Asserts]
jsonpath "$" count == 2
jsonpath "$[0].doc" == 20
jsonpath "$[1].doc" == 10


# Distinguish array indexes from numeric object keys.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
```
.items | if type == "array" then .[0].sku elif type == "object" then .["0"].sku else empty end
```
HTTP 200
[Asserts]
jsonpath "$" count == 2
jsonpath "$[0].doc" == "array"
jsonpath "$[1].doc" == "object"


# Stream each jq output on its own line, including arrays.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Accept: application/x-ndjson
```
select(.score == 10) | .score, [.products[].price]
```
HTTP 200
[Asserts]
header "Content-Type" == "application/x-ndjson"
header "Trailer" == "Query-Status"
header "Query-Status" == "ok"
body split "\n" count == 3
body split "\n" nth 0 jsonpath "$.id" == "{{score10_id}}"
body split "\n" nth 0 jsonpath "$.rev" == "{{score10_rev}}"
body split "\n" nth 0 jsonpath "$.doc" == 10
body split "\n" nth 1 jsonpath "$.id" == "{{score10_id}}"
body split "\n" nth 1 jsonpath "$.rev" == "{{score10_rev}}"
body split "\n" nth 1 jsonpath "$.doc" count == 2
body split "\n" nth 1 jsonpath "$.doc[0]" == 15
body split "\n" nth 1 jsonpath "$.doc[1]" == 8


# Report a runtime failure after sending the first output.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Accept: application/x-ndjson
```
select(.score == 20) | .score, error("failed")
```
HTTP 200
[Asserts]
header "Trailer" == "Query-Status"
header "Query-Status" == "error"
header "Cursor" not exists
body split "\n" count == 2
body split "\n" nth 0 jsonpath "$.doc" == 20


# A query with no outputs still completes successfully.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Accept: application/x-ndjson
```
empty
```
HTTP 200
[Asserts]
header "Trailer" == "Query-Status"
header "Query-Status" == "ok"
body == ""


# Resume an indexed projection across JSON and NDJSON.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Limit: 1
```
select(.score >= 10) | .score
```
HTTP 200
[Captures]
score_cursor: header "Cursor"
[Asserts]
header "Cursor" != ""
jsonpath "$" count == 1
jsonpath "$[0].id" == "{{score10_id}}"
jsonpath "$[0].rev" == "{{score10_rev}}"
jsonpath "$[0].doc" == 10

QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Accept: application/x-ndjson
Cursor: {{score_cursor}}
```
select(.score >= 10) | .score
```
HTTP 200
[Asserts]
header "Trailer" contains "Cursor"
header "Query-Status" == "ok"
header "Cursor" not exists
body split "\n" count == 2
body split "\n" nth 0 jsonpath "$.id" == "{{score20_id}}"
body split "\n" nth 0 jsonpath "$.rev" == "{{score20_rev}}"
body split "\n" nth 0 jsonpath "$.doc" == 20


# Read an NDJSON cursor trailer and resume an identity scan.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Accept: application/x-ndjson
Limit: 2
```
.
```
HTTP 200
[Captures]
scan_cursor: header "Cursor"
[Asserts]
header "Trailer" contains "Cursor"
header "Query-Status" == "ok"
header "Cursor" != ""
body split "\n" count == 3
body split "\n" nth 0 jsonpath "$.id" == "{{score20_id}}"
body split "\n" nth 1 jsonpath "$.id" == "{{score10_id}}"

QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Limit: 2
Cursor: {{scan_cursor}}
```
.
```
HTTP 200
[Asserts]
header "Cursor" not exists
jsonpath "$" count == 2
jsonpath "$[0].doc.items[0].sku" == "array"
jsonpath "$[1].doc.items['0'].sku" == "object"


# A cursor cannot resume a different query.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
Cursor: {{scan_cursor}}
```
.score
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"


# Clean up query state.
DELETE {{base_url}}/db/{{database}}-query
HTTP 204
