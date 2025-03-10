export function web4_get() {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>AI Proxy Demo</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
      h1 { color: #333; }
      .chat-container { border: 1px solid #ddd; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
      #messages { height: 300px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
      textarea { width: 100%; padding: 10px; }
      button { padding: 10px 15px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>AI Proxy Demo</h1>
    <div class="chat-container">
      <div id="messages"></div>
      <textarea id="question" rows="3" placeholder="Type your message here..."></textarea>
      <button id="askButton">Send Message</button>
    </div>

    <script>
      const baseUrl = "http://localhost:3000";
      const proxyUrl = \`\${baseUrl}/proxy\`;
      let conversation = [
        { role: "system", content: "You are a helpful assistant." },
      ];

      document.getElementById('askButton').addEventListener('click', async () => {
        const question = document.getElementById('question').value;
        if (!question.trim()) return;

        const messagesDiv = document.getElementById('messages');
        document.getElementById('question').value = '';

        messagesDiv.innerHTML += \`<div><strong>You:</strong> \${question}</div>\`;

        conversation.push({ role: "user", content: question });

        try {
          const assistantElement = document.createElement('div');
          assistantElement.innerHTML = \`<strong>Assistant:</strong> <div class="loading">Thinking...</div>\`;
          messagesDiv.appendChild(assistantElement);

          messagesDiv.scrollTop = messagesDiv.scrollHeight;

          const response = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: conversation })
          });

          if (!response.ok) {
            throw new Error(\`Error: \${response.status}\`);
          }

          const reader = response.body.getReader();
          let assistantResponse = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            const lines = chunk.split("\\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.substring(6);
                if (data === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(data);

                  if (parsed.choices &&
                      parsed.choices.length > 0 &&
                      parsed.choices[0].delta &&
                      parsed.choices[0].delta.content) {

                    assistantResponse += parsed.choices[0].delta.content;
                    assistantElement.innerHTML = \`<strong>Assistant:</strong> \${assistantResponse}\`;
                  }
                } catch (e) {
                  console.error("Error parsing JSON:", e);
                }
              }
            }
          }

          conversation.push({ role: "assistant", content: assistantResponse });

        } catch (error) {
          console.error(error);
          messagesDiv.innerHTML += \`<div><strong>Error:</strong> \${error.message}</div>\`;
        }
      });
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

export function start_ai_conversation() {
  const args = JSON.parse(env.input());
  const conversation_id = args.conversation_id;

  if (!conversation_id) {
    env.panic("Error: must provide conversation_id");
    return;
  }

  const existing_conversation = env.get_data(conversation_id);
  if (existing_conversation) {
    env.panic("Error: conversation already exists");
    return;
  }

  env.set_data(
    conversation_id,
    JSON.stringify({
      active: true,
    })
  );

  env.value_return(conversation_id);
}

export function view_ai_conversation() {
  const args = JSON.parse(env.input());
  const conversation_id = args.conversation_id;

  if (!conversation_id) {
    env.panic("Error: must provide conversation_id");
    return;
  }

  const data = env.get_data(conversation_id);
  if (!data) {
    env.panic(`Error: No conversation found for ${conversation_id}`);
  }

  env.value_return(data);
}