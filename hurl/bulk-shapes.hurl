# Only exact export wrappers are unwrapped.
POST {{base_url}}/db
Content-Type: application/json
{"name":"{{database}}-shapes","indices":[{"name":"kind","path":"/kind"}]}
HTTP 201

POST {{base_url}}/db/{{database}}-shapes
Content-Type: application/x-ndjson
```
{"id":"old","rev":"old","doc":{"kind":"a","value":1}}
{"kind":"b","value":2}
{"id":"old","rev":"old","doc":{"kind":"c"},"extra":true}
{"id":"ordinary","doc":{"kind":"d"}}
{"id":null,"rev":"old","doc":{"kind":"e"}}
{"id":"old","rev":1,"doc":{"kind":"f"}}
```
HTTP 200
[Asserts]
jsonpath "$.success" == true

QUERY {{base_url}}/db/{{database}}-shapes
Content-Type: text/plain
```
[., inputs] | sort_by(.kind // .doc.kind)
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc" count == 6
jsonpath "$[0].doc[0].kind" == "a"
jsonpath "$[0].doc[0].value" == 1
jsonpath "$[0].doc[0].id" not exists
jsonpath "$[0].doc[1].kind" == "b"
jsonpath "$[0].doc[2].id" == "old"
jsonpath "$[0].doc[2].rev" == "old"
jsonpath "$[0].doc[2].extra" == true
jsonpath "$[0].doc[2].doc.kind" == "c"
jsonpath "$[0].doc[3].id" == "ordinary"
jsonpath "$[0].doc[3].rev" not exists
jsonpath "$[0].doc[4].id" == null
jsonpath "$[0].doc[5].rev" == 1

QUERY {{base_url}}/db/{{database}}-shapes
Content-Type: text/plain
```
select(.kind == "a")
```
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].doc.value" == 1


# A rejected wrapped value cannot change a nonempty indexed database.
POST {{base_url}}/db/{{database}}-shapes
Content-Type: application/x-ndjson
```
{"kind":"new"}
{"id":"old","rev":"old","doc":42}
```
HTTP 400
[Asserts]
jsonpath "$.success" == false
jsonpath "$.error.code" == "invalid_document"
jsonpath "$.error.line" == 2

POST {{base_url}}/db/{{database}}-shapes
Content-Type: application/x-ndjson
```
{"kind":"new"}
{"id":"old","rev":"old","doc":[]}
```
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_document"
jsonpath "$.error.line" == 2

QUERY {{base_url}}/db/{{database}}-shapes
Content-Type: text/plain
```
select(.kind == "new")
```
HTTP 200
[Asserts]
jsonpath "$" count == 0

GET {{base_url}}/db/{{database}}-shapes
HTTP 200
[Asserts]
jsonpath "$.doc_count" == 6


# A single JSON object never unwraps fields that resemble an export.
POST {{base_url}}/db/{{database}}-shapes
Content-Type: application/json
{"id":"ordinary","rev":"ordinary","doc":{"kind":"g"}}
HTTP 201
[Captures]
ordinary_id: jsonpath "$.id"

GET {{base_url}}/db/{{database}}-shapes/{{ordinary_id}}
HTTP 200
[Asserts]
jsonpath "$.id" == "ordinary"
jsonpath "$.rev" == "ordinary"
jsonpath "$.doc.kind" == "g"

POST {{base_url}}/db/{{database}}-shapes?x=1
Content-Type: application/x-ndjson
```
{}
```
HTTP 400
[Asserts]
jsonpath "$.success" == false
jsonpath "$.error.code" == "invalid_query"

DELETE {{base_url}}/db/{{database}}-shapes
HTTP 204
