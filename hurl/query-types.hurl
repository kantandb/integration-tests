# Index equality preserves numeric spellings; ranges compare numeric values.
POST {{base_url}}/db
Content-Type: application/json
{"name":"{{database}}-types","indices":[{"name":"score","path":"/score"}]}
HTTP 201

POST {{base_url}}/db/{{database}}-types
Content-Type: application/x-ndjson
```
{"kind":"integer","score":3}
{"kind":"decimal","score":3.0}
{"kind":"exponent","score":3e0}
{"kind":"string","score":"3"}
{"kind":"null","score":null}
{"kind":"false","score":false}
{"kind":"array","score":[]}
{"kind":"object","score":{}}
{"kind":"missing"}
```
HTTP 200
[Asserts]
jsonpath "$.success" == true

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score == 3)
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc.kind" == "integer"

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score == 3.0)
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc.kind" == "decimal"

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score == 3e0)
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc.kind" == "exponent"

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
(select(.score == 3))
```
HTTP 200
[Asserts]
jsonpath "$" count == 3

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score >= 3)
```
HTTP 200
[Asserts]
jsonpath "$" count == 3

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score > 2)
```
HTTP 200
[Asserts]
jsonpath "$" count == 3

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
(select(.score > 2))
```
HTTP 200
[Asserts]
jsonpath "$" count == 6

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score == "3")
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc.kind" == "string"

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score == false)
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc.kind" == "false"

QUERY {{base_url}}/db/{{database}}-types
Content-Type: text/plain
```
select(.score == null)
```
HTTP 200
[Asserts]
jsonpath "$" count == 2

DELETE {{base_url}}/db/{{database}}-types
HTTP 204
