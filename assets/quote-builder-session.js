(function () {
  const sharedKey = 'goldsure_quote_agent';
  const legacyKeys = ['agentName', 'ac_agent', 'hw_agent', 'nswhw_agent'];

  function read(storage, key) {
    try { return (storage.getItem(key) || '').trim(); } catch (_) { return ''; }
  }

  function write(storage, key, value) {
    try { storage.setItem(key, value); } catch (_) {}
  }

  function remove(storage, key) {
    try { storage.removeItem(key); } catch (_) {}
  }

  window.GoldsureQuoteSession = {
    get() {
      let agent = read(localStorage, sharedKey) || read(sessionStorage, sharedKey);
      if (!agent) {
        for (const key of legacyKeys) {
          agent = read(localStorage, key) || read(sessionStorage, key);
          if (agent) break;
        }
      }
      if (agent) {
        write(localStorage, sharedKey, agent);
        write(sessionStorage, sharedKey, agent);
      }
      return agent;
    },

    set(agent) {
      const value = String(agent || '').trim();
      if (!value) return;
      write(localStorage, sharedKey, value);
      write(sessionStorage, sharedKey, value);
    },

    clear() {
      [sharedKey, ...legacyKeys].forEach(key => {
        remove(localStorage, key);
        remove(sessionStorage, key);
      });
    }
  };
})();
