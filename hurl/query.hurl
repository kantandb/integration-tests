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
body == "[5,8]"


# Query numeric scores in document order, not index order.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
```
.score | numbers | select(. >= 10)
```
HTTP 200
[Asserts]
body == "[20,10]"


# Distinguish array indexes from numeric object keys.
QUERY {{base_url}}/db/{{database}}-query
Content-Type: text/plain
```
.items | if type == "array" then .[0].sku elif type == "object" then .["0"].sku else empty end
```
HTTP 200
[Asserts]
body == "[\"array\",\"object\"]"


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
body == "10\n[15,8]\n"


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
body == "20\n"


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


# Clean up query state.
DELETE {{base_url}}/db/{{database}}-query
HTTP 204
