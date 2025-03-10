use futures::SinkExt;
use serde_json::{json, Value};
use spin_sdk::{
    http::{self, Headers, IncomingResponse, Method, OutgoingResponse, Request, ResponseOutparam},
    http_component,
    variables,
};

fn cors_headers_entries() -> Vec<(String, Vec<u8>)> {
    vec![
        (
            "Access-Control-Allow-Origin".to_string(),
            "*".to_string().into_bytes(),
        ),
        (
            "Access-Control-Allow-Methods".to_string(),
            "POST, GET, OPTIONS".to_string().into_bytes(),
        ),
        (
            "Access-Control-Allow-Headers".to_string(),
            "Content-Type, Authorization".to_string().into_bytes(),
        ),
        (
            "Access-Control-Allow-Credentials".to_string(),
            "true".to_string().into_bytes(),
        ),
    ]
}

fn cors_headers() -> Headers {
    Headers::from_list(&cors_headers_entries()).unwrap_or_else(|_| Headers::new())
}

#[http_component]
async fn handle_request(request: Request, response_out: ResponseOutparam) {
    match (request.method(), request.path_and_query().as_deref()) {
        // Handle CORS preflight requests
        (Method::Options, Some(path)) if path.starts_with("/mcp/") => {
            let response = OutgoingResponse::new(cors_headers());
            if let Err(e) = response.set_status_code(200) {
                eprintln!("Error setting status code: {:?}", e);
                return server_error(response_out);
            }
            response_out.set(response);
        },
        // Main MCP proxy endpoint
        (Method::Post, Some("/mcp/proxy")) => {
            handle_mcp_proxy_request(request, response_out).await;
        },
        // Simple status endpoint
        (Method::Get, _) => {
            let response = OutgoingResponse::new(Headers::new());
            if let Err(e) = response.set_status_code(200) {
                eprintln!("Error setting status code: {:?}", e);
                return server_error(response_out);
            }

            let body_content = b"<html><body><h1>MCP Proxy API</h1></body></html>";
            let mut body = response.take_body();
            if let Err(e) = body.send(body_content.to_vec()).await {
                eprintln!("Error writing body content: {e}");
                server_error(response_out);
                return;
            }

            response_out.set(response);
        }
        _ => {
            eprintln!("Method not allowed");
            method_not_allowed(response_out);
        }
    }
}

async fn handle_mcp_proxy_request(request: Request, response_out: ResponseOutparam) {
    // Parse the request body
    let incoming_request_body: Value = match serde_json::from_slice::<Value>(&request.into_body()[..]) {
        Ok(body) => body,
        Err(e) => {
            eprintln!("Error parsing request body: {}", e);
            return forbidden(response_out, "Invalid JSON in request body").await;
        }
    };

    // Extract MCP method and params
    let method = match incoming_request_body.get("method") {
        Some(m) => m.as_str().unwrap_or(""),
        None => {
            eprintln!("Missing method in request");
            return forbidden(response_out, "Missing method in request").await;
        }
    };

    let params = match incoming_request_body.get("params") {
        Some(p) => p.clone(),
        None => Value::Object(serde_json::Map::new()),
    };

    let id = match incoming_request_body.get("id") {
        Some(i) => i.clone(),
        None => {
            eprintln!("Missing id in request");
            return forbidden(response_out, "Missing id in request").await;
        }
    };

    // Extract server endpoint from metadata if available
    let server_endpoint = match params.get("_meta").and_then(|m| m.get("serverEndpoint")) {
        Some(endpoint) => match endpoint.as_str() {
            Some(s) => s.to_string(),
            None => {
                eprintln!("serverEndpoint is not a string");
                return forbidden(response_out, "serverEndpoint must be a string").await;
            }
        },
        None => {
            // Fallback to default endpoint from variables
            match variables::get("mcp_server_endpoint") {
                Ok(endpoint) => endpoint,
                Err(e) => {
                    eprintln!("Missing MCP server endpoint: {}", e);
                    return forbidden(response_out, "Missing MCP server endpoint in request and no default configured").await;
                }
            }
        }
    };

    // Create clean params without _meta field
    let mut clean_params = params.clone();
    if let Some(obj) = clean_params.as_object_mut() {
        obj.remove("_meta");
    }

    // Prepare the JSON-RPC request body
    let jsonrpc_body = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": clean_params
    });

    eprintln!("Forwarding request to MCP server: {} at {}", method, server_endpoint);
    eprintln!("Body: {}", jsonrpc_body.to_string());

    // The TypeScript server expects messages at /messages, not at the root
    let messages_endpoint = format!("{}/messages", server_endpoint);

    // Create the request to the MCP server
    let mcp_request = Request::builder()
        .method(Method::Post)
        .uri(messages_endpoint)
        .header("Content-Type", "application/json")
        .body(jsonrpc_body.to_string())
        .build();

    // Send the request to the MCP server
    match http::send::<_, IncomingResponse>(mcp_request).await {
        Ok(mcp_response) => {
            forward_response(mcp_response, response_out).await;
        },
        Err(e) => {
            eprintln!("Error sending request to MCP server: {:?}", e);
            let error_response = json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32603,
                    "message": format!("Error communicating with MCP server: {}", e)
                }
            });

            let response = OutgoingResponse::new(cors_headers());
            if let Err(e) = response.set_status_code(200) {
                eprintln!("Error setting status code: {:?}", e);
                return server_error(response_out);
            }

            let mut body = response.take_body();
            if let Err(e) = body.send(error_response.to_string().into_bytes()).await {
                eprintln!("Error writing body content: {e}");
                server_error(response_out);
                return;
            }

            response_out.set(response);
        }
    }
}

async fn forward_response(mcp_response: IncomingResponse, response_out: ResponseOutparam) {
    let status = mcp_response.status();
    eprintln!("Received response with status: {}", status);
    
    let response_data = match mcp_response.into_body().await {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Error reading MCP response body: {:?}", e);
            return server_error(response_out);
        }
    };

    let response_str = String::from_utf8_lossy(&response_data);
    eprintln!("Response body: {}", response_str);

    let response = OutgoingResponse::new(cors_headers());
    if let Err(e) = response.set_status_code(200) {
        eprintln!("Error setting status code: {:?}", e);
        return server_error(response_out);
    }

    let mut body = response.take_body();
    if let Err(e) = body.send(response_data).await {
        eprintln!("Error writing body content: {e}");
        server_error(response_out);
        return;
    }

    response_out.set(response);
}

fn server_error(response_out: ResponseOutparam) {
    eprintln!("Internal server error");
    respond(500, response_out)
}

fn method_not_allowed(response_out: ResponseOutparam) {
    eprintln!("Method not allowed");
    respond(405, response_out)
}

async fn forbidden(response_out: ResponseOutparam, reason: &str) {
    eprintln!("Forbidden: {}", reason);
    let response = OutgoingResponse::new(cors_headers());
    if let Err(e) = response.set_status_code(403) {
        eprintln!("Error setting status code: {:?}", e);
        server_error(response_out);
        return;
    }

    if let Err(e) = response.take_body().send(reason.as_bytes().to_vec()).await {
        eprintln!("Error writing body content: {e}");
        server_error(response_out);
        return;
    }

    response_out.set(response);
}

fn respond(status: u16, response_out: ResponseOutparam) {
    let response = OutgoingResponse::new(cors_headers());
    if let Err(e) = response.set_status_code(status) {
        eprintln!("Error setting status code: {:?}", e);
        // Fall back to a very basic response
        let basic_response = OutgoingResponse::new(Headers::new());
        response_out.set(basic_response);
        return;
    }

    response_out.set(response);
}