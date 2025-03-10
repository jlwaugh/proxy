export function web4_get() {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP Client Demo</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1, h2 { color: #2563eb; }
        .container { display: flex; flex-direction: column; gap: 20px; }
        .panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .output { height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; padding: 10px; margin: 10px 0; background-color: #f9fafb; }
        button { padding: 10px 16px; background-color: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
        button:hover { background-color: #1d4ed8; }
        input, select, textarea { width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid #d1d5db; border-radius: 4px; }
        .code { font-family: monospace; background-color: #f1f5f9; padding: 2px 4px; }
        .error { color: #dc2626; }
        .success { color: #16a34a; }
      </style>
    </head>
    <body>
      <h1>MCP Client Demo</h1>
      <p>This demo connects to the TypeScript MCP server.</p>

      <div class="container">
        <div class="panel">
          <h2>Initialize Connection</h2>
          <div>
            <label for="serverEndpoint">MCP Server Endpoint:</label>
            <input type="text" id="serverEndpoint" value="https://9e54-107-13-130-95.ngrok-free.app" />
            <p><small>The TypeScript server should be running at this address</small></p>
          </div>
          <button id="initializeBtn">Initialize</button>
        </div>

        <div class="panel">
          <h2>List Available Tools</h2>
          <button id="listToolsBtn" disabled>List Tools</button>
          <div id="toolsOutput" class="output"></div>
        </div>

        <div class="panel">
          <h2>Call a Tool</h2>
          <div>
            <label for="toolName">Tool Name:</label>
            <input type="text" id="toolName" disabled />
          </div>
          <div>
            <label for="toolArgs">Tool Arguments (JSON):</label>
            <textarea id="toolArgs" rows="4" disabled>{}</textarea>
          </div>
          <button id="callToolBtn" disabled>Call Tool</button>
          <div id="toolResultOutput" class="output"></div>
        </div>
      </div>

      <script>
        // MCP Client
        class McpClient {
          constructor(proxyUrl) {
            this.proxyUrl = proxyUrl;
            this.requestId = 0;
            this.initialized = false;
            this.serverEndpoint = null;
            this.eventSource = null;
          }

          // Establish SSE connection first
          async connectSSE(serverEndpoint) {
            return new Promise((resolve, reject) => {
              // Close existing connection if any
              if (this.eventSource) {
                this.eventSource.close();
              }

              this.serverEndpoint = serverEndpoint;
              const sseUrl = \`\${serverEndpoint}/sse\`;
              
              console.log(\`Connecting to SSE endpoint: \${sseUrl}\`);
              this.eventSource = new EventSource(sseUrl);
              
              this.eventSource.onopen = () => {
                console.log('SSE connection established');
                resolve();
              };
              
              this.eventSource.onerror = (error) => {
                console.error('SSE connection error:', error);
                this.eventSource.close();
                reject(new Error('Failed to establish SSE connection'));
              };
              
              this.eventSource.onmessage = (event) => {
                console.log('SSE message received:', event.data);
                // Handle incoming SSE messages if needed
              };
              
              // Set a timeout in case the connection hangs
              setTimeout(() => {
                if (this.eventSource.readyState !== 1) { // 1 = OPEN
                  this.eventSource.close();
                  reject(new Error('SSE connection timeout'));
                }
              }, 10000);
            });
          }

          async sendRequest(method, params = {}) {
            const id = ++this.requestId;

            // Add server endpoint to metadata if available
            if (this.serverEndpoint) {
              params = {
                ...params,
                _meta: {
                  serverEndpoint: this.serverEndpoint
                }
              };
            }

            try {
              console.log('Sending request:', { method, params });
              
              const response = await fetch(this.proxyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  method,
                  params
                })
              });

              if (!response.ok) {
                throw new Error(\`HTTP error \${response.status}\`);
              }

              const data = await response.json();
              console.log('Received response:', data);

              if (data.error) {
                throw new Error(\`MCP error: \${data.error.message}\`);
              }

              return data.result;
            } catch (error) {
              console.error(\`Error calling \${method}:\`, error);
              throw error;
            }
          }

          async initialize(serverEndpoint) {
            try {
              // First establish SSE connection
              await this.connectSSE(serverEndpoint);
              
              // Then send initialize request
              const result = await this.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                clientInfo: {
                  name: 'web4-mcp-client',
                  version: '0.1.0'
                },
                capabilities: {
                  tools: {}
                }
              });

              this.initialized = true;
              return result;
            } catch (error) {
              this.initialized = false;
              throw error;
            }
          }

          async listTools() {
            if (!this.initialized) {
              throw new Error('Client not initialized');
            }

            return this.sendRequest('tools/list');
          }

          async callTool(name, args = {}) {
            if (!this.initialized) {
              throw new Error('Client not initialized');
            }

            return this.sendRequest('tools/call', {
              name,
              arguments: args
            });
          }
          
          disconnect() {
            if (this.eventSource) {
              this.eventSource.close();
              this.eventSource = null;
            }
            this.initialized = false;
          }
        }

        // DOM Elements
        const serverEndpointInput = document.getElementById('serverEndpoint');
        const initializeBtn = document.getElementById('initializeBtn');
        const listToolsBtn = document.getElementById('listToolsBtn');
        const toolsOutput = document.getElementById('toolsOutput');
        const toolNameInput = document.getElementById('toolName');
        const toolArgsInput = document.getElementById('toolArgs');
        const callToolBtn = document.getElementById('callToolBtn');
        const toolResultOutput = document.getElementById('toolResultOutput');

        // Initialize client with the Spin component URL
        const proxyUrl = "https://mcp-web4-23uk2hte.fermyon.app/mcp/proxy";
        const client = new McpClient(proxyUrl);

        // Event listeners
        initializeBtn.addEventListener('click', async () => {
          const serverEndpoint = serverEndpointInput.value.trim();
          if (!serverEndpoint) {
            showError(toolsOutput, 'Please enter a server endpoint');
            return;
          }

          try {
            toolsOutput.innerHTML = 'Initializing...';
            const result = await client.initialize(serverEndpoint);

            toolsOutput.innerHTML = \`<div class="success">
              <p>Successfully connected to MCP server!</p>
              <p>Server: \${result.serverInfo ? result.serverInfo.name : 'Unknown'} \${result.serverInfo ? 'v' + result.serverInfo.version : ''}</p>
              <p>Protocol: \${result.protocolVersion}</p>
            </div>\`;

            // Enable buttons
            listToolsBtn.disabled = false;
          } catch (error) {
            showError(toolsOutput, \`Failed to initialize: \${error.message}\`);
          }
        });

        listToolsBtn.addEventListener('click', async () => {
          try {
            toolsOutput.innerHTML = 'Loading tools...';
            const result = await client.listTools();

            if (!result.tools || result.tools.length === 0) {
              toolsOutput.innerHTML = '<p>No tools available.</p>';
              return;
            }

            // Display tools
            let html = '<h3>Available Tools:</h3><ul>';
            result.tools.forEach(tool => {
              html += \`<li>
                <strong>\${tool.name}</strong>
                \${tool.description ? \`<p>\${tool.description}</p>\` : ''}
                <button class="select-tool" data-tool='\${JSON.stringify(tool)}'>Select</button>
              </li>\`;
            });
            html += '</ul>';

            toolsOutput.innerHTML = html;

            // Add event listeners to select buttons
            document.querySelectorAll('.select-tool').forEach(button => {
              button.addEventListener('click', (e) => {
                const tool = JSON.parse(e.target.getAttribute('data-tool'));
                toolNameInput.value = tool.name;

                // Create a sample argument object based on the input schema
                const sampleArgs = {};
                if (tool.inputSchema && tool.inputSchema.properties) {
                  Object.keys(tool.inputSchema.properties).forEach(prop => {
                    sampleArgs[prop] = "";
                  });
                }

                toolArgsInput.value = JSON.stringify(sampleArgs, null, 2);

                // Enable inputs and button
                toolNameInput.disabled = false;
                toolArgsInput.disabled = false;
                callToolBtn.disabled = false;
              });
            });
          } catch (error) {
            showError(toolsOutput, \`Failed to list tools: \${error.message}\`);
          }
        });

        callToolBtn.addEventListener('click', async () => {
          const toolName = toolNameInput.value.trim();
          let toolArgs;

          try {
            toolArgs = JSON.parse(toolArgsInput.value);
          } catch (error) {
            showError(toolResultOutput, 'Invalid JSON in tool arguments');
            return;
          }

          try {
            toolResultOutput.innerHTML = 'Calling tool...';
            const result = await client.callTool(toolName, toolArgs);

            let resultHtml = '<h3>Tool Result:</h3>';

            if (result.isError) {
              resultHtml += \`<div class="error"><p>Tool returned an error</p></div>\`;
            }

            // Display content
            if (result.content && result.content.length > 0) {
              result.content.forEach(item => {
                if (item.type === 'text') {
                  resultHtml += \`<pre>\${item.text}</pre>\`;
                } else if (item.type === 'image') {
                  resultHtml += \`<p>[Image content]</p>\`;
                } else if (item.type === 'resource') {
                  resultHtml += \`<p>[Resource: \${item.resource.uri}]</p>\`;
                }
              });
            } else {
              resultHtml += '<p>Tool returned no content</p>';
            }

            toolResultOutput.innerHTML = resultHtml;
          } catch (error) {
            showError(toolResultOutput, \`Failed to call tool: \${error.message}\`);
          }
        });

        function showError(element, message) {
          element.innerHTML = \`<div class="error">\${message}</div>\`;
          console.error(message);
        }
      </script>
    </body>
    </html>
    `;

    env.value_return(
      JSON.stringify({
        contentType: "text/html; charset=UTF-8",
        body: env.base64_encode(html)
      })
    );
  }