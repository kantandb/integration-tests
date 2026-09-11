# Create an isolated database for JSONPath queries.
POST {{base_url}}/
Content-Type: application/json
{
  "name": "{{database}}-query",
  "indexes": [
    {
      "name": "score",
      "path": "/score"
    }
  ]
}
HTTP 201


# Advertise QUERY support.
OPTIONS {{base_url}}/{{database}}-query
HTTP 204
[Asserts]
header "Accept-Query" == "application/json"
header "Allow" == "GET, QUERY, DELETE, OPTIONS"


# Create documents for scan and indexed queries.
POST {{base_url}}/{{database}}-query/
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
query_first_id: jsonpath "$.id"

POST {{base_url}}/{{database}}-query/
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
query_second_id: jsonpath "$.id"

POST {{base_url}}/{{database}}-query/
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
[Captures]
query_array_id: jsonpath "$.id"

POST {{base_url}}/{{database}}-query/
Content-Type: application/json
{
  "items": {
    "0": {
      "sku": "object"
    }
  }
}
HTTP 201
[Captures]
query_object_id: jsonpath "$.id"


# Scan wildcard results in document ID order.
QUERY {{base_url}}/{{database}}-query
Content-Type: application/json; charset=utf-8
{
  "path": "$.products[*].price",
  "op": "lt",
  "value": 10
}
HTTP 200
[Asserts]
header "Accept-Query" == "application/json"
header "Cache-Control" == "no-store"
jsonpath "$.documents" count == 2
jsonpath "$.documents[0]" == "{{query_first_id}}"
jsonpath "$.documents[1]" == "{{query_second_id}}"
jsonpath "$.cursor" == ""


# Use index-value order and an opaque cursor.
QUERY {{base_url}}/{{database}}-query
Content-Type: application/json
{
  "path": "$.score",
  "op": "ge",
  "value": 10,
  "limit": 1
}
HTTP 200
[Captures]
query_score_cursor: jsonpath "$.cursor"
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{query_second_id}}"
jsonpath "$.cursor" != ""
jsonpath "$.cursor" != "{{query_second_id}}"

QUERY {{base_url}}/{{database}}-query
Content-Type: application/json
{
  "path": "$.other",
  "op": "ge",
  "value": 10,
  "limit": 1,
  "cursor": "{{query_score_cursor}}"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

QUERY {{base_url}}/{{database}}-query
Content-Type: application/json
{
  "path": "$.score",
  "op": "gt",
  "value": 10,
  "limit": 1,
  "cursor": "{{query_score_cursor}}"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

QUERY {{base_url}}/{{database}}-query
Content-Type: application/json
{
  "path": "$.score",
  "op": "ge",
  "value": 11,
  "limit": 1,
  "cursor": "{{query_score_cursor}}"
}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

GET {{base_url}}/{{database}}-query?index=score&op=ge&value=10&cursor={{query_score_cursor}}
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_cursor"

QUERY {{base_url}}/{{database}}-query
Content-Type: application/json
{
  "path": "$['score']",
  "op": "ge",
  "value": 10,
  "limit": 1,
  "cursor": "{{query_score_cursor}}"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{query_first_id}}"
jsonpath "$.cursor" == ""


# Distinguish array indexes from numeric object members.
QUERY {{base_url}}/{{database}}-query
Content-Type: application/json
{
  "path": "$.items[0].sku",
  "value": "array"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{query_array_id}}"
jsonpath "$.cursor" == ""

QUERY {{base_url}}/{{database}}-query
Content-Type: application/json
{
  "path": "$.items['0'].sku",
  "value": "object"
}
HTTP 200
[Asserts]
jsonpath "$.documents" count == 1
jsonpath "$.documents[0]" == "{{query_object_id}}"
jsonpath "$.cursor" == ""


# Clean up query state.
DELETE {{base_url}}/{{database}}-query
HTTP 204
