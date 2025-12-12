const { useState, useEffect } = React;

const postJson = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const fallback = await response.text().catch(() => '');
    throw new Error(fallback || 'Request failed');
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
};

function App() {
  const [queueProvider, setQueueProvider] = useState('sqs');
  const [availableProviders, setAvailableProviders] = useState([]);
  const [queueName, setQueueName] = useState('');
  const [payload, setPayload] = useState('');
  const [messages, setMessages] = useState([]);
  const [subscribedMessages, setSubscribedMessages] = useState([]);
  const [status, setStatus] = useState('Ready to go.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionInterval, setSubscriptionInterval] = useState(null);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const response = await fetch('/queues/providers');
        if (!response.ok) {
          throw new Error('Failed to load providers');
        }
        const data = await response.json();
        const providers = data.providers || [];
        const activeProvider = data.activeProvider;
        setAvailableProviders(providers);
        if (activeProvider) {
          setQueueProvider(activeProvider);
        }
      } catch (err) {
        setAvailableProviders([]);
      }
    };

    loadProviders();
  }, []);

  const ensureQueueName = () => queueName.trim();

  const sendMessage = async () => {
    const queue = ensureQueueName();
    if (!queue) {
      setError('Queue name is required.');
      return;
    }

    setBusy(true);
    setError('');
    setStatus('Sending message...');

    try {
      await postJson(`/queues/${queueProvider}/${queue}/publish`, {
        payload: payload || '(empty message)',
      });

      setPayload('');
      setStatus('Message published.');
    } catch (err) {
      setError(err.message || 'Failed to send message.');
    } finally {
      setBusy(false);
    }
  };

  const readMessages = async () => {
    const queue = ensureQueueName();
    if (!queue) {
      setError('Queue name is required.');
      return;
    }

    setBusy(true);
    setError('');
    setStatus('Fetching messages...');

    try {
      const pulled = await postJson(`/queues/${queueProvider}/${queue}/pull`, {
        maxMessages: 10,
      });

      const list = Array.isArray(pulled) ? pulled : [];
      setMessages(list);

      // Ack each message when a receipt is available.
      await Promise.all(
        list
          .filter((msg) => msg && msg.receipt)
          .map((msg) =>
            postJson(`/queues/${queueProvider}/${queue}/ack`, {
              receipt: msg.receipt,
            }),
          ),
      );

      setStatus(
        list.length ? 'Fetched ' + list.length + ' message(s).' : 'No messages available.',
      );
    } catch (err) {
      setError(err.message || 'Failed to read messages.');
    } finally {
      setBusy(false);
    }
  };

  const pollMessages = async () => {
    const queue = ensureQueueName();
    if (!queue) return;

    try {
      const pulled = await postJson(`/queues/${queueProvider}/${queue}/pull`, {
        maxMessages: 5,
      });

      const list = Array.isArray(pulled) ? pulled : [];
      if (list.length > 0) {
        setSubscribedMessages((prev) => {
          // Add new messages, avoiding duplicates
          const existingIds = new Set(prev.map((m) => m.id || m.receipt));
          const newMessages = list.filter((m) => !existingIds.has(m.id || m.receipt));
          return [...newMessages, ...prev].slice(0, 50); // Keep last 50 messages
        });

        // Auto-ack messages
        await Promise.all(
          list
            .filter((msg) => msg && msg.receipt)
            .map((msg) =>
              postJson(`/queues/${queueProvider}/${queue}/ack`, {
                receipt: msg.receipt,
              }).catch(() => {
                // Ignore ack errors
              }),
            ),
        );
      }
    } catch (err) {
      // Silently handle errors during polling
      console.error('Polling error:', err);
    }
  };

  const toggleSubscription = () => {
    const queue = ensureQueueName();
    if (!queue) {
      setError('Queue name is required.');
      return;
    }

    if (isSubscribed) {
      // Stop subscription
      if (subscriptionInterval) {
        clearInterval(subscriptionInterval);
        setSubscriptionInterval(null);
      }
      setIsSubscribed(false);
      setStatus('Subscription stopped.');
    } else {
      // Start subscription
      setSubscribedMessages([]);
      setIsSubscribed(true);
      setStatus('Subscribing to queue...');
      setError('');

      // Poll every 2 seconds
      const interval = setInterval(pollMessages, 2000);
      setSubscriptionInterval(interval);
      // Poll immediately
      pollMessages();
    }
  };

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (subscriptionInterval) {
        clearInterval(subscriptionInterval);
      }
    };
  }, [subscriptionInterval]);

  return (
    <div className="page">
      <h1>Queue Demo UI</h1>
      <p>Publish messages and read them back using the queue API.</p>

      <div className="stack">
        <div className="stack">
          <label htmlFor="queueProvider">Queue Provider</label>
          <select
            id="queueProvider"
            value={queueProvider}
            onChange={(e) => setQueueProvider(e.target.value)}
            disabled={busy}
          >
            {availableProviders.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="stack">
          <label htmlFor="queueName">Queue name</label>
          <input
            id="queueName"
            value={queueName}
            placeholder="Enter queue name"
            onChange={(e) => setQueueName(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="stack">
          <label htmlFor="payload">Message</label>
          <input
            id="payload"
            value={payload}
            placeholder="Write something to publish..."
            onChange={(e) => setPayload(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                sendMessage();
              }
            }}
            disabled={busy}
          />
        </div>

        <div className="row">
          <button onClick={sendMessage} disabled={busy}>
            Send message
          </button>
          <button className="secondary" onClick={readMessages} disabled={busy || isSubscribed}>
            Read latest messages
          </button>
          <button
            className={isSubscribed ? 'danger' : 'success'}
            onClick={toggleSubscription}
            disabled={busy}
          >
            {isSubscribed ? 'Stop subscription' : 'Subscribe to queue'}
          </button>
        </div>

        {isSubscribed && (
          <div className="status ok">
            ✓ Actively subscribed to queue "{queueName}" using {queueProvider.toUpperCase()}. Messages will appear below as they arrive.
          </div>
        )}

        {status && !error && <div className="status ok">{status}</div>}

        {error && (
          <div className="status error" role="alert">
            {error}
          </div>
        )}

        {!isSubscribed && (
          <div className="stack">
            <label>Fetched messages</label>
            <ul className="messages">
              {messages.length === 0 && <li className="status muted">Nothing to show yet.</li>}
              {messages.map((msg) => (
                <li key={msg.id || msg.receipt} className="message">
                  <div className="meta">
                    {msg.id ? 'ID: ' + msg.id : 'Pending message'}
                    {msg.correlationId && ' • Correlation: ' + msg.correlationId}
                  </div>
                  <div>{String(msg.payload ? msg.payload : '')}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isSubscribed && (
          <div className="stack">
            <label>
              Subscribed messages ({subscribedMessages.length})
              {subscribedMessages.length > 0 && (
                <button
                  className="link"
                  onClick={() => setSubscribedMessages([])}
                  style={{ marginLeft: '8px', fontSize: '12px', padding: '4px 8px' }}
                >
                  Clear
                </button>
              )}
            </label>
            <ul className="messages">
              {subscribedMessages.length === 0 && (
                <li className="status muted">Waiting for messages...</li>
              )}
              {subscribedMessages.map((msg) => (
                <li key={msg.id || msg.receipt} className="message subscribed">
                  <div className="meta">
                    {msg.id ? 'ID: ' + msg.id : 'Pending message'}
                    {msg.correlationId && ' • Correlation: ' + msg.correlationId}
                    {msg.publishedAt && ' • ' + new Date(msg.publishedAt).toLocaleTimeString()}
                  </div>
                  <div>{String(msg.payload ? msg.payload : '')}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

