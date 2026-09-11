GET {{base_url}}/healthz
HTTP 200
[Asserts]
header "Content-Type" startsWith "application/json"
jsonpath "$.status" == "ok"
