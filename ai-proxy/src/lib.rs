use futures::{SinkExt, StreamExt};
use serde_json::Value;
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
        (Method::Options, Some("/proxy")) => {
            let response = OutgoingResponse::new(cors_headers());
            if let Err(e) = response.set_status_code(200) {
                eprintln!("Error setting status code: {:?}", e);
                return server_error(response_out);
            }
            response_out.set(response);
        },
        (Method::Post, Some("/proxy")) => {
            // Safely parse the request body
            let incoming_request_body: Value = match serde_json::from_slice::<Value>(&request.into_body()[..]) {
                Ok(body) => body,
                Err(e) => {
                    eprintln!("Error parsing request body: {}", e);
                    return forbidden(response_out, "Invalid JSON in request body").await;
                }
            };

            // Safely get messages
            let messages = match incoming_request_body.get("messages") {
                Some(msgs) => msgs.clone(),
                None => {
                    eprintln!("Missing messages in request");
                    return forbidden(response_out, "Missing messages in request").await;
                }
            };

            // Safely get tools
            let tools = match incoming_request_body.get("tools") {
                Some(t) => t.clone(),
                None => Value::Array(vec![]), // Default to empty array if not provided
            };

            match proxy_ai(messages, tools).await {
                Ok(incoming_response) => {
                    if incoming_response.status() != 200 {
                        let response_data = match incoming_response.into_body().await {
                            Ok(data) => data,
                            Err(e) => {
                                eprintln!("Error reading response body: {:?}", e);
                                return server_error(response_out);
                            }
                        };

                        let response_string = match String::from_utf8(response_data) {
                            Ok(s) => s,
                            Err(e) => {
                                eprintln!("Error converting response to string: {:?}", e);
                                return server_error(response_out);
                            }
                        };

                        eprintln!("Error in response from LLM endpoint: {:?}", response_string);
                        return server_error(response_out);
                    }

                    let mut incoming_response_body = incoming_response.take_body_stream();
                    let mut headers_entries = cors_headers_entries().clone();
                    headers_entries.push((
                        String::from("content-type"),
                        "text/event-stream; charset=utf-8".as_bytes().to_vec(),
                    ));

                    let headers = match Headers::from_list(&headers_entries) {
                        Ok(h) => h,
                        Err(e) => {
                            eprintln!("Error creating headers: {:?}", e);
                            return server_error(response_out);
                        }
                    };

                    let outgoing_response = OutgoingResponse::new(headers);
                    let mut outgoing_response_body = outgoing_response.take_body();

                    response_out.set(outgoing_response);

                    // Stream the LLM response chunks back to the client
                    while let Some(chunk) = incoming_response_body.next().await {
                        match chunk {
                            Ok(data) => {
                                // Stream the response chunk back to the client
                                if let Err(e) = outgoing_response_body.send(data).await {
                                    eprintln!("Error sending response chunk: {e}");
                                    return;
                                }
                            }
                            Err(e) => {
                                eprintln!("Error reading response chunk: {e}");
                                return;
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Error proxying to AI: {:?}", e);
                    server_error(response_out);
                }
            }
        }
        (Method::Get, _) => {
            let response = OutgoingResponse::new(Headers::new());
            if let Err(e) = response.set_status_code(200) {
                eprintln!("Error setting status code: {:?}", e);
                return server_error(response_out);
            }

            let body_content = b"<html><body><h1>LLM Proxy API</h1></body></html>";
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

async fn proxy_ai(messages: Value, tools: Value) -> anyhow::Result<IncomingResponse> {
    let request_body = serde_json::json!({
        "model": "gpt-4o",
        "messages": messages,
        "tools": tools,
        "stream": true,
        "stream_options": {
            "include_usage": true
        }
    });

    let ai_completions_endpoint = match variables::get("ai_completions_endpoint") {
        Ok(endpoint) => endpoint,
        Err(e) => return Err(anyhow::anyhow!("Missing ai_completions_endpoint: {}", e)),
    };

    let api_key = match variables::get("api_key") {
        Ok(key) => key,
        Err(e) => return Err(anyhow::anyhow!("Missing api_key: {}", e)),
    };

    let api_key_method = variables::get("api_key_method")
        .unwrap_or_else(|_| "authorization".to_string());

    let mut ai_request_builder = Request::builder();
    ai_request_builder
        .method(Method::Post)
        .uri(ai_completions_endpoint)
        .header("Content-Type", "application/json");

    let ai_request = match api_key_method.as_str() {
        "api-key" => ai_request_builder.header("Api-Key", api_key),
        _ => ai_request_builder.header("Authorization", format!("Bearer {}", api_key)),
    }
    .body(request_body.to_string())
    .build();

    http::send::<_, IncomingResponse>(ai_request).await
        .map_err(|e| anyhow::anyhow!("Error sending request to LLM: {}", e))
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