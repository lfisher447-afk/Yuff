// --- YOUR EXACT AD BLOCKER & MONITOR (IIFE) ---
const BlockMonitor = {
    count: 0, maxEntries: 30,
    log: function(type, url, containerId) {
        try {
            const monitor = document.querySelector(`#${containerId} .blockMonitor`);
            const list = document.querySelector(`#${containerId} .blockList`);
            const counter = document.querySelector(`#${containerId} .blockCount`);
            if (!monitor) return;
            monitor.style.display = 'block';
            this.count++;
            counter.textContent = this.count;
            const entry = document.createElement('div');
            entry.style.cssText = `margin-bottom: 6px; padding: 10px; background: #fff; border-left: 3px solid red;`;
            entry.innerHTML = `<strong>Blocked ${type}</strong>: ${url.substring(0, 50)}`;
            list.insertBefore(entry, list.firstChild);
        } catch (e) {}
    }
};

(function() {
    const originalOpen = window.open;
    window.open = function(url) {
        BlockMonitor.log('popup', url || 'Unknown', app.activeTabId);
        return null;
    };
    window.addEventListener('click', function(e) {
        if (e.isTrusted) {
            setTimeout(() => { if (window.opener) { BlockMonitor.log('popunder', 'Popunder', app.activeTabId); window.close(); } }, 100);
        }
    }, true);
    
    // Custom Elements Blocker (From Settings)
    const observer = new MutationObserver(function(mutations) {
        const settings = JSON.parse(localStorage.getItem('nexusSettings')) || {};
        const customElements = settings.customElements ? settings.customElements.split(',').map(s=>s.trim()) : ['.ad-overlay', '.popup-ad'];
        
        mutations.forEach(function(mutation) {
            mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) {
                    customElements.forEach(selector => {
                        if (node.matches && node.matches(selector)) {
                            BlockMonitor.log('ad', `Overlay Removed: ${selector}`, app.activeTabId);
                            node.remove();
                        }
                    });
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();

// --- TABBED BROWSER & AI SYSTEM ---
const app = {
    tabs: [], activeTabId: null, tabCounter: 0, chatMessages:[],

    init() {
        this.loadSettings();
        this.createTab();
        document.getElementById('globalUrlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const activeEl = document.querySelector(`#${this.activeTabId} .urlInput`);
                activeEl.value = e.target.value;
                this.extractStream(this.activeTabId);
            }
        });
    },

    createTab() {
        const id = `tab_${++this.tabCounter}`;
        this.tabs.push({ id, streamData: null, consentGiven: false, consentTimestamp: null });

        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.id = `ui_${id}`;
        tabEl.innerHTML = `<span class="title">New Tab</span><button onclick="event.stopPropagation(); app.closeTab('${id}')"><i class="fas fa-times"></i></button>`;
        tabEl.onclick = () => this.switchTab(id);
        document.getElementById('tabBar').insertBefore(tabEl, document.querySelector('.new-tab-btn'));

        const contentTemplate = document.getElementById('tab-template').content.cloneNode(true);
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'tab-content';
        contentWrapper.id = id;
        contentWrapper.appendChild(contentTemplate);
        document.getElementById('tabContents').appendChild(contentWrapper);

        // Bind events for this specific tab (Your exact UI flow)
        const checkbox = contentWrapper.querySelector('.consentCheckbox');
        const analyzeBtn = contentWrapper.querySelector('.analyzeBtn');
        const streamSelect = contentWrapper.querySelector('.streamSelect');
        const urlInput = contentWrapper.querySelector('.urlInput');

        checkbox.addEventListener('change', () => this.handleConsentChange(id, checkbox.checked, analyzeBtn));
        analyzeBtn.addEventListener('click', () => this.extractStream(id));
        streamSelect.addEventListener('change', () => this.changeStream(id, streamSelect.value));
        urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.extractStream(id); });

        this.switchTab(id);
    },

    switchTab(id) {
        this.activeTabId = id;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`ui_${id}`).classList.add('active');
        document.getElementById(id).classList.add('active');
    },

    closeTab(id) {
        this.tabs = this.tabs.filter(t => t.id !== id);
        document.getElementById(`ui_${id}`).remove();
        document.getElementById(id).remove();
        if (this.tabs.length > 0) this.switchTab(this.tabs[this.tabs.length - 1].id);
        else this.createTab();
    },

    // --- YOUR EXACT CONSENT & EXTRACTION LOGIC (Adapted for Tabs) ---
    handleConsentChange(tabId, checked, btn) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (checked) {
            tab.consentGiven = true; tab.consentTimestamp = new Date().toISOString();
            btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
        } else {
            tab.consentGiven = false; tab.consentTimestamp = null;
            btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed';
        }
    },

    async extractStream(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        const container = document.getElementById(tabId);
        const url = container.querySelector('.urlInput').value;
        const loading = container.querySelector('.loading');
        const error = container.querySelector('.error');
        const playerSection = container.querySelector('.playerSection');

        if (!tab.consentGiven) { error.textContent = "You must agree to the terms."; error.style.display = 'block'; return; }
        if (!url) return;

        loading.style.display = 'block';
        error.style.display = 'none';

        try {
            // Call the Node.js Server
            const response = await fetch('/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url, consent: { given: tab.consentGiven, timestamp: tab.consentTimestamp } })
            });
            const data = await response.json();
            
            if (data.error) { error.innerHTML = `${data.message}<br>${data.help}`; error.style.display = 'block'; return; }
            
            tab.streamData = data;
            document.getElementById(`ui_${tabId}`).querySelector('.title').textContent = data.title || 'Extracted';
            this.displayStream(tabId, data);
        } catch (err) {
            error.textContent = `Failed to extract: ${err.message}`;
            error.style.display = 'block';
        } finally {
            loading.style.display = 'none';
        }
    },

    displayStream(tabId, data) {
        const container = document.getElementById(tabId);
        const select = container.querySelector('.streamSelect');
        const playerSec = container.querySelector('.player-section');
        const title = container.querySelector('.streamTitle');

        title.textContent = data.title;
        select.innerHTML = '<option value="">Choose a stream...</option>';
        
        if (data.iframes && data.iframes.length > 0) {
            data.iframes.forEach((iframe, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = iframe.label || iframe.src.substring(0, 40);
                select.appendChild(option);
            });
            container.querySelector('.stream-selector').style.display = 'block';
            select.value = 0;
            this.loadIframe(tabId, data.iframes[0]);
        }
        playerSec.style.display = 'block';
    },

    loadIframe(tabId, iframeData) {
        const container = document.getElementById(tabId);
        const playerCont = container.querySelector('.playerContainer');
        playerCont.innerHTML = '';
        
        const iframe = document.createElement('iframe');
        // CRITICAL: We route the extracted src through YOUR Server-Side Proxy System!
        iframe.src = `/proxy?url=${encodeURIComponent(iframeData.src)}`;
        iframe.allowFullscreen = true;
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
        
        playerCont.appendChild(iframe);
    },

    changeStream(tabId, index) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab.streamData && tab.streamData.iframes[index]) {
            this.loadIframe(tabId, tab.streamData.iframes[index]);
        }
    },

    // --- AI & SETTINGS LOGIC ---
    toggleSidebar() { document.getElementById('aiSidebar').classList.toggle('active'); },
    openSettings() { document.getElementById('settingsModal').classList.add('active'); },

    async sendChatMessage() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;

        const hist = document.getElementById('chatHistory');
        hist.innerHTML += `<div class="chat-msg msg-user">${text}</div>`;
        input.value = '';

        const settings = JSON.parse(localStorage.getItem('nexusSettings')) || {};
        this.chatMessages.push({ role: 'user', content: text });

        try {
            const res = await fetch('/api/ai', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: settings.aiUrl, apiKey: settings.aiKey, model: 'gpt-3.5-turbo', messages: this.chatMessages })
            });
            const data = await res.json();
            const reply = data.choices[0].message.content;
            this.chatMessages.push({ role: 'assistant', content: reply });
            hist.innerHTML += `<div class="chat-msg msg-ai">${reply}</div>`;
            hist.scrollTop = hist.scrollHeight;
        } catch (e) { hist.innerHTML += `<div class="chat-msg msg-ai">Error: Check API Key in Settings</div>`; }
    },

    saveSettings() {
        const config = {
            engine: document.getElementById('setEngine').value,
            spoof: document.getElementById('setSpoof').value,
            nodes: document.getElementById('setNodes').value,
            customElements: document.getElementById('setCustomElements').value,
            aiUrl: document.getElementById('setAiUrl').value,
            aiKey: document.getElementById('setAiKey').value
        };
        localStorage.setItem('nexusSettings', JSON.stringify(config));
        document.cookie = `proxyConfig=${btoa(JSON.stringify(config))}; path=/`; // Sends Scramjet/Libcurl prefs to backend
        document.getElementById('settingsModal').classList.remove('active');
        alert("Settings Saved! Custom Elements and Node routing updated.");
    },

    loadSettings() {
        const config = JSON.parse(localStorage.getItem('nexusSettings')) || {};
        if(config.engine) document.getElementById('setEngine').value = config.engine;
        if(config.spoof) document.getElementById('setSpoof').value = config.spoof;
        if(config.nodes) document.getElementById('setNodes').value = config.nodes;
        if(config.customElements) document.getElementById('setCustomElements').value = config.customElements;
        if(config.aiUrl) document.getElementById('setAiUrl').value = config.aiUrl;
        if(config.aiKey) document.getElementById('setAiKey').value = config.aiKey;
    }
};

window.onload = () => app.init();
