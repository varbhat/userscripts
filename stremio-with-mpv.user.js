// ==UserScript==
// @name         Stremio with mpv
// @namespace    https://github.com/varbhat/userscripts
// @version      1.0
// @icon         https://www.google.com/s2/favicons?sz=64&domain=stremio.com
// @description  Integrates stremio web with mpv
// @author       https://github.com/varbhat
// @match        https://web.stremio.com/*
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // Load settings from storage (with defaults)
    let settings = {
        fullscreen: GM_getValue('fullscreen', true),
        pip: GM_getValue('pip', false),
        enqueue: GM_getValue('enqueue', false),
        newWindow: GM_getValue('newWindow', false),
        player: GM_getValue('player', ''),
        flags: GM_getValue('flags', ''),
        stopBrowserMedia: GM_getValue('stopBrowserMedia', true),
        pauseStremioOnOpen: GM_getValue('pauseStremioOnOpen', true)
    };

    // ==================== Stremio Stream Extraction ====================

    function base64UrlDecodeToUtf8(str) {
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }
        try {
            const byteString = atob(base64);
            const bytes = new Uint8Array(byteString.length);
            for (let i = 0; i < byteString.length; i++) {
                bytes[i] = byteString.charCodeAt(i);
            }
            return new TextDecoder().decode(bytes);
        } catch (e) {
            console.error("[Stremio mpv] base64UrlDecodeToUtf8 error:", e);
            return null;
        }
    }

    function extractUrlFromPlayerHash(hash) {
        if (!hash || !hash.startsWith('#/player/')) {
            return null;
        }

        let pathData = hash.substring('#/player/'.length);
        const segments = pathData.split('/');

        if (segments.length === 0) {
            return null;
        }

        const videoInfoSegment = segments[0];

        try {
            const actualBase64String = decodeURIComponent(videoInfoSegment);
            const decodedJsonString = base64UrlDecodeToUtf8(actualBase64String);

            if (!decodedJsonString) {
                console.error("[Stremio mpv] Base64 decoding failed");
                return null;
            }

            const jsonStartMarker = '{"url":';
            let jsonStartIndex = decodedJsonString.indexOf(jsonStartMarker);
            if (jsonStartIndex === -1) {
                jsonStartIndex = decodedJsonString.indexOf('{');
            }

            if (jsonStartIndex === -1) {
                console.error('[Stremio mpv] Could not find start of JSON object');
                return null;
            }

            const initialCleanedJson = decodedJsonString.substring(jsonStartIndex);
            const lastBraceIndex = initialCleanedJson.lastIndexOf('}');

            if (lastBraceIndex === -1) {
                console.error("[Stremio mpv] No closing '}' found in JSON data");
                return null;
            }

            const finalCleanedJson = initialCleanedJson.substring(0, lastBraceIndex + 1);
            const streamInfo = JSON.parse(finalCleanedJson);

            if (streamInfo && streamInfo.url) {
                return {
                    url: streamInfo.url,
                    name: streamInfo.name || 'Unknown',
                    behaviorHints: streamInfo.behaviorHints || {}
                };
            }

            return null;
        } catch (e) {
            console.error('[Stremio mpv] Error processing video info:', e);
            return null;
        }
    }

    function getCurrentStremioStream() {
        const hash = window.location.hash;
        return extractUrlFromPlayerHash(hash);
    }

    // ==================== Settings Panel ====================

    function createSettingsPanel() {
        if (document.getElementById('mpv-settings-overlay')) {
            document.getElementById('mpv-settings-overlay').style.display = 'flex';
            updateSettingsUI();
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'mpv-settings-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
            background: #1e1e1e;
            border-radius: 12px;
            padding: 24px;
            min-width: 380px;
            max-width: 450px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            color: #fff;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid #333;
        `;

        const title = document.createElement('h2');
        title.textContent = '⚙️ mpv Settings';
        title.style.cssText = `
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            color: #fff;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            font-size: 28px;
            cursor: pointer;
            color: #888;
            padding: 0;
            line-height: 1;
            transition: color 0.2s;
        `;
        closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
        closeBtn.onmouseout = () => closeBtn.style.color = '#888';
        closeBtn.onclick = () => overlay.style.display = 'none';

        header.appendChild(title);
        header.appendChild(closeBtn);

        const settingsContainer = document.createElement('div');
        settingsContainer.id = 'mpv-settings-container';
        settingsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        function createSectionHeader(text) {
            const sectionHeader = document.createElement('div');
            sectionHeader.style.cssText = `
                font-size: 12px;
                font-weight: 600;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-top: 8px;
                margin-bottom: 4px;
            `;
            sectionHeader.textContent = text;
            return sectionHeader;
        }

        function createToggle(label, description, settingKey) {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                background: #2a2a2a;
                border-radius: 8px;
            `;

            const labelContainer = document.createElement('div');
            labelContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 2px;
                flex: 1;
                margin-right: 16px;
            `;

            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            labelEl.style.cssText = `font-size: 14px; color: #e0e0e0;`;

            const descEl = document.createElement('span');
            descEl.textContent = description;
            descEl.style.cssText = `font-size: 11px; color: #777;`;

            labelContainer.appendChild(labelEl);
            labelContainer.appendChild(descEl);

            const toggle = document.createElement('label');
            toggle.style.cssText = `
                position: relative;
                display: inline-block;
                width: 48px;
                height: 26px;
                cursor: pointer;
                flex-shrink: 0;
            `;

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = settings[settingKey];
            input.dataset.setting = settingKey;
            input.style.cssText = `opacity: 0; width: 0; height: 0;`;

            const slider = document.createElement('span');
            slider.style.cssText = `
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: ${settings[settingKey] ? '#4CAF50' : '#555'};
                border-radius: 26px;
                transition: 0.3s;
            `;

            const knob = document.createElement('span');
            knob.style.cssText = `
                position: absolute;
                height: 20px;
                width: 20px;
                left: ${settings[settingKey] ? '25px' : '3px'};
                bottom: 3px;
                background-color: white;
                border-radius: 50%;
                transition: 0.3s;
            `;

            slider.appendChild(knob);

            input.onchange = () => {
                const isChecked = input.checked;
                slider.style.backgroundColor = isChecked ? '#4CAF50' : '#555';
                knob.style.left = isChecked ? '25px' : '3px';
                settings[settingKey] = isChecked;
                GM_setValue(settingKey, isChecked);
            };

            toggle.appendChild(input);
            toggle.appendChild(slider);
            row.appendChild(labelContainer);
            row.appendChild(toggle);

            return row;
        }

        function createTextInput(label, description, settingKey, placeholder) {
            const container = document.createElement('div');
            container.style.cssText = `padding: 12px 16px; background: #2a2a2a; border-radius: 8px;`;

            const labelContainer = document.createElement('div');
            labelContainer.style.cssText = `display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px;`;

            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            labelEl.style.cssText = `font-size: 14px; color: #e0e0e0;`;

            const descEl = document.createElement('span');
            descEl.textContent = description;
            descEl.style.cssText = `font-size: 11px; color: #777;`;

            labelContainer.appendChild(labelEl);
            labelContainer.appendChild(descEl);

            const input = document.createElement('input');
            input.type = 'text';
            input.value = settings[settingKey];
            input.placeholder = placeholder;
            input.dataset.setting = settingKey;
            input.style.cssText = `
                width: 100%;
                padding: 10px 12px;
                background: #1e1e1e;
                border: 1px solid #444;
                border-radius: 6px;
                color: #fff;
                font-size: 13px;
                box-sizing: border-box;
                transition: border-color 0.2s;
            `;

            input.onfocus = () => input.style.borderColor = '#4CAF50';
            input.onblur = () => input.style.borderColor = '#444';
            input.oninput = () => {
                settings[settingKey] = input.value;
                GM_setValue(settingKey, input.value);
            };

            container.appendChild(labelContainer);
            container.appendChild(input);

            return container;
        }

        // Build settings UI
        settingsContainer.appendChild(createSectionHeader('Playback Options'));
        settingsContainer.appendChild(createToggle('Fullscreen', 'Start video in fullscreen mode', 'fullscreen'));
        settingsContainer.appendChild(createToggle('Picture-in-Picture', 'Start video in PiP mode', 'pip'));

        settingsContainer.appendChild(createSectionHeader('Queue Options'));
        settingsContainer.appendChild(createToggle('Enqueue', 'Add to queue instead of playing', 'enqueue'));
        settingsContainer.appendChild(createToggle('New Window', 'Open in a new window', 'newWindow'));

        settingsContainer.appendChild(createSectionHeader('Browser & Stremio'));
        settingsContainer.appendChild(createToggle('Stop Browser Media', 'Pause browser media when opening', 'stopBrowserMedia'));
        settingsContainer.appendChild(createToggle('Pause Stremio', 'Pause Stremio when opening in mpv', 'pauseStremioOnOpen'));

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = `
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid #333;
            display: flex;
            justify-content: space-between;
        `;

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset to Defaults';
        resetBtn.style.cssText = `
            background: transparent;
            color: #888;
            border: 1px solid #444;
            padding: 10px 16px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        resetBtn.onmouseover = () => { resetBtn.style.borderColor = '#666'; resetBtn.style.color = '#fff'; };
        resetBtn.onmouseout = () => { resetBtn.style.borderColor = '#444'; resetBtn.style.color = '#888'; };
        resetBtn.onclick = () => {
            if (confirm('Reset all settings to defaults?')) {
                settings = {
                    fullscreen: true, pip: false, enqueue: false, newWindow: false,
                    player: '', flags: '', stopBrowserMedia: true, pauseStremioOnOpen: true
                };
                Object.keys(settings).forEach(key => GM_setValue(key, settings[key]));
                updateSettingsUI();
            }
        };

        const doneBtn = document.createElement('button');
        doneBtn.textContent = 'Done';
        doneBtn.style.cssText = `
            background: #4CAF50;
            color: white;
            border: none;
            padding: 10px 32px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
        `;
        doneBtn.onmouseover = () => doneBtn.style.background = '#45a049';
        doneBtn.onmouseout = () => doneBtn.style.background = '#4CAF50';
        doneBtn.onclick = () => overlay.style.display = 'none';

        footer.appendChild(resetBtn);
        footer.appendChild(doneBtn);

        panel.appendChild(header);
        panel.appendChild(settingsContainer);
        panel.appendChild(footer);
        overlay.appendChild(panel);

        overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display === 'flex') overlay.style.display = 'none';
        });

        document.body.appendChild(overlay);
    }

    function updateSettingsUI() {
        const container = document.getElementById('mpv-settings-container');
        if (!container) return;

        container.querySelectorAll('input[type="checkbox"]').forEach(input => {
            const key = input.dataset.setting;
            if (key && settings.hasOwnProperty(key)) {
                input.checked = settings[key];
                const slider = input.nextElementSibling;
                const knob = slider.querySelector('span');
                slider.style.backgroundColor = settings[key] ? '#4CAF50' : '#555';
                knob.style.left = settings[key] ? '25px' : '3px';
            }
        });

        container.querySelectorAll('input[type="text"]').forEach(input => {
            const key = input.dataset.setting;
            if (key && settings.hasOwnProperty(key)) input.value = settings[key];
        });
    }

    // ==================== Core Functions ====================

    function notify(message, isError = false) {
        document.querySelectorAll('.mpv-notification').forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = 'mpv-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${isError ? '#e74c3c' : '#4CAF50'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 999999;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.3s, transform 0.3s;
        `;
        document.body.appendChild(notification);

        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(10px)';
            setTimeout(() => notification.remove(), 300);
        }, 2500);
    }

    function stopAllBrowserMedia() {
        document.querySelectorAll('video, audio').forEach(el => {
            if (!el.paused) el.pause();
        });
    }

    function stopStremioPlayer() {
        const video = document.querySelector('video');
        if (video && !video.paused) video.pause();
    }

    function openInMpv(streamUrl, options = {}) {
        if (!streamUrl || streamUrl.trim() === '') {
            notify('No stream URL found', true);
            return;
        }

        streamUrl = streamUrl.trim();

        if (settings.stopBrowserMedia && options.skipBrowserMediaStop !== true) {
            stopAllBrowserMedia();
        }

        const encodedUrl = encodeURIComponent(streamUrl);
        let mpvUrl = `mpv:///open?url=${encodedUrl}`;

        if (settings.fullscreen) mpvUrl += '&full_screen=1';
        if (settings.pip) mpvUrl += '&pip=1';
        if (settings.enqueue) mpvUrl += '&enqueue=1';
        if (settings.newWindow) mpvUrl += '&new_window=1';
        if (settings.player) mpvUrl += `&player=${encodeURIComponent(settings.player)}`;
        if (settings.flags) mpvUrl += `&flags=${encodeURIComponent(settings.flags)}`;

        console.log('[Stremio mpv] Opening:', mpvUrl);

        try {
            GM_openInTab(mpvUrl, { active: true, insert: true });
            if (options.onOpen) setTimeout(options.onOpen, 100);
        } catch (error) {
            console.error('[Stremio mpv] Error:', error);
            window.open(mpvUrl, '_blank');
            if (options.onOpen) setTimeout(options.onOpen, 100);
        }
    }

    function playCurrentStream() {
        const stream = getCurrentStremioStream();
        if (stream) {
            openInMpv(stream.url, {
                onOpen: () => {
                    if (settings.pauseStremioOnOpen) stopStremioPlayer();
                }
            });
            notify(`Opening: ${stream.name}`);
        } else {
            notify('No active stream found', true);
        }
    }

    // Get stream URL by intercepting clipboard
    function getStreamUrlFromCopyButton(copyButton) {
        return new Promise((resolve) => {
            const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);

            navigator.clipboard.writeText = async (text) => {
                navigator.clipboard.writeText = originalWriteText;
                resolve(text);
                return Promise.resolve();
            };

            copyButton.click();

            setTimeout(() => {
                navigator.clipboard.writeText = originalWriteText;
                resolve(null);
            }, 500);
        });
    }

    // ==================== Button Injection ====================

    // Create mpv button for stream selection context menu
    function createStreamMenuButton() {
        const button = document.createElement('div');
        button.setAttribute('tabindex', '0');
        button.setAttribute('title', 'Open in mpv');
        button.className = 'context-menu-option-container-BZGla button-container-zVLH6 mpv-button';

        button.innerHTML = `
            <svg class="menu-icon-JD2rP" viewBox="0 0 24 24" style="fill: currentcolor;">
                <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h16V6H4zm6.5 2.5l5 3.5-5 3.5v-7z"/>
            </svg>
            <div class="context-menu-option-label-EbNNz">Open in mpv</div>
        `;

        return button;
    }

    // Create mpv button for player context menu
    function createPlayerMenuButton() {
        const button = document.createElement('div');
        button.setAttribute('tabindex', '0');
        button.className = 'option-container-m_jZq button-container-zVLH6 mpv-player-button';

        button.innerHTML = `
            <svg class="icon-krR0X" viewBox="0 0 24 24" style="fill: currentcolor;">
                <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h16V6H4zm6.5 2.5l5 3.5-5 3.5v-7z"/>
            </svg>
            <div class="label-cmqqu">Open in mpv</div>
        `;

        return button;
    }

    // Inject button into stream selection context menu
    function injectStreamMenuButton(contextMenu) {
        if (contextMenu.querySelector('.mpv-button')) return;

        const copyButton = contextMenu.querySelector('[title="Copy stream link"]');
        if (!copyButton) return;

        const mpvButton = createStreamMenuButton();

        mpvButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const streamUrl = await getStreamUrlFromCopyButton(copyButton);

            if (streamUrl) {
                openInMpv(streamUrl, {
                    onOpen: () => {
                        if (settings.pauseStremioOnOpen) stopStremioPlayer();
                        document.body.click();
                    }
                });
                notify('Opening in mpv...');
            } else {
                notify('Failed to get stream URL', true);
            }
        });

        copyButton.after(mpvButton);
    }

    // Inject button into player right-click context menu
    function injectPlayerMenuButton(contextMenu) {
        if (contextMenu.querySelector('.mpv-player-button')) return;

        // Find the "Copy stream link" button in player menu
        const copyButton = Array.from(contextMenu.querySelectorAll('.option-container-m_jZq'))
            .find(el => el.querySelector('.label-cmqqu')?.textContent === 'Copy stream link');

        if (!copyButton) return;

        const mpvButton = createPlayerMenuButton();

        mpvButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Try to get URL from hash first (more reliable)
            const stream = getCurrentStremioStream();

            if (stream) {
                openInMpv(stream.url, {
                    onOpen: () => {
                        if (settings.pauseStremioOnOpen) stopStremioPlayer();
                        document.body.click();
                    }
                });
                notify(`Opening: ${stream.name}`);
            } else {
                // Fallback to clipboard method
                const streamUrl = await getStreamUrlFromCopyButton(copyButton);

                if (streamUrl) {
                    openInMpv(streamUrl, {
                        onOpen: () => {
                            if (settings.pauseStremioOnOpen) stopStremioPlayer();
                            document.body.click();
                        }
                    });
                    notify('Opening in mpv...');
                } else {
                    notify('Failed to get stream URL', true);
                }
            }
        });

        copyButton.after(mpvButton);
    }

    // ==================== Keyboard Shortcut ====================

    document.addEventListener('keydown', (e) => {
        // Alt + M to open current stream in mpv
        if (e.altKey && e.key.toLowerCase() === 'm') {
            e.preventDefault();
            playCurrentStream();
        }
    });

    // ==================== Initialization ====================

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check for stream selection context menu
                    const streamMenu = node.classList?.contains('context-menu-content-Xe_lN')
                        ? node
                        : node.querySelector?.('.context-menu-content-Xe_lN');

                    if (streamMenu) {
                        setTimeout(() => injectStreamMenuButton(streamMenu), 10);
                    }

                    // Check for player right-click context menu
                    // Look for container with option-container-m_jZq buttons
                    const playerMenuOptions = node.querySelectorAll?.('.option-container-m_jZq');
                    if (playerMenuOptions && playerMenuOptions.length > 0) {
                        const parentContainer = playerMenuOptions[0].parentElement;
                        if (parentContainer) {
                            setTimeout(() => injectPlayerMenuButton(parentContainer), 10);
                        }
                    }

                    // Also check if the node itself contains the player menu structure
                    if (node.querySelector?.('.option-container-m_jZq .label-cmqqu')) {
                        setTimeout(() => injectPlayerMenuButton(node), 10);
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Periodic check for menus
    setInterval(() => {
        // Stream selection menu
        const streamMenu = document.querySelector('.context-menu-content-Xe_lN');
        if (streamMenu) injectStreamMenuButton(streamMenu);

        // Player context menu - find by looking for the Copy stream link option
        const playerMenuOptions = document.querySelectorAll('.option-container-m_jZq');
        playerMenuOptions.forEach(option => {
            const label = option.querySelector('.label-cmqqu');
            if (label?.textContent === 'Copy stream link') {
                const parentContainer = option.parentElement;
                if (parentContainer) injectPlayerMenuButton(parentContainer);
            }
        });
    }, 500);

    // Register menu commands
    GM_registerMenuCommand('🎬 Play current stream in mpv', playCurrentStream);
    GM_registerMenuCommand('⚙️ mpv Settings', createSettingsPanel);

    console.log('[Stremio mpv] Userscript loaded');
    console.log('[Stremio mpv] Keyboard shortcut: Alt+M');
})();
