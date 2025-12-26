// ==UserScript==
// @name         open in mpv
// @namespace    https://github.com/varbhat/userscripts
// @version      3.6
// @description  Open URLs in mpv player
// @author       https://github.com/varbhat
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=mpv.io
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
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
        stremioPauseOnOpen: GM_getValue('stremioPauseOnOpen', true),
        stopBrowserMedia: GM_getValue('stopBrowserMedia', true),
        // yt-dlp options
        ytdlpQuality: GM_getValue('ytdlpQuality', ''),
        ytdlpAudioOnly: GM_getValue('ytdlpAudioOnly', false),
        ytdlpFormat: GM_getValue('ytdlpFormat', ''),
        ytdlpCustomOptions: GM_getValue('ytdlpCustomOptions', '')
    };

    // ==================== Browser Media Control ====================

    function isYouTubeSite() {
        const hostname = window.location.hostname;
        return hostname === 'www.youtube.com' ||
               hostname === 'youtube.com' ||
               hostname === 'm.youtube.com' ||
               hostname === 'music.youtube.com';
    }

    function stopYouTubePlayer() {
        // Method 1: Direct video element pause
        const video = document.querySelector('video.html5-main-video, video.video-stream');
        if (video && !video.paused) {
            video.pause();
            console.log('[Open in mpv] Paused YouTube video element');
            return true;
        }

        // Method 2: Click the play/pause button when it shows "Pause"
        const playButton = document.querySelector('.ytp-play-button');
        if (playButton) {
            const title = playButton.getAttribute('title') || '';
            const ariaLabel = playButton.getAttribute('aria-label') || '';
            // Check if video is playing (button shows "Pause")
            if (title.toLowerCase().includes('pause') || ariaLabel.toLowerCase().includes('pause')) {
                playButton.click();
                console.log('[Open in mpv] Clicked YouTube pause button');
                return true;
            }
        }

        // Method 3: Use YouTube's player API if available
        const ytPlayer = document.querySelector('#movie_player');
        if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
            ytPlayer.pauseVideo();
            console.log('[Open in mpv] Used YouTube player API to pause');
            return true;
        }

        // Method 4: Find any video element and pause it
        const anyVideo = document.querySelector('video');
        if (anyVideo && !anyVideo.paused) {
            anyVideo.pause();
            console.log('[Open in mpv] Paused generic video on YouTube');
            return true;
        }

        // Method 5: Simulate 'k' keypress (YouTube keyboard shortcut for pause)
        const playerContainer = document.querySelector('#movie_player, #player-container, ytd-player');
        if (playerContainer) {
            const event = new KeyboardEvent('keydown', {
                key: 'k',
                code: 'KeyK',
                keyCode: 75,
                which: 75,
                bubbles: true,
                cancelable: true
            });
            playerContainer.dispatchEvent(event);
            console.log('[Open in mpv] Sent "k" keypress to YouTube player');
            return true;
        }

        return false;
    }

    function stopAllBrowserMedia() {
        // Handle YouTube specifically
        if (isYouTubeSite()) {
            stopYouTubePlayer();
            return;
        }

        // Stop all video elements
        document.querySelectorAll('video').forEach(video => {
            if (!video.paused) {
                video.pause();
                console.log('[Open in mpv] Paused video element');
            }
        });

        // Stop all audio elements
        document.querySelectorAll('audio').forEach(audio => {
            if (!audio.paused) {
                audio.pause();
                console.log('[Open in mpv] Paused audio element');
            }
        });

        // Try to pause media in iframes (same-origin only)
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                    iframeDoc.querySelectorAll('video, audio').forEach(media => {
                        if (!media.paused) {
                            media.pause();
                            console.log('[Open in mpv] Paused media in iframe');
                        }
                    });
                }
            } catch (e) {
                // Cross-origin iframe, can't access
            }
        });

        // Try common player pause buttons as fallback
        const pauseSelectors = [
            'button[aria-label*="Pause"]',
            'button[aria-label*="pause"]',
            'button[title*="Pause"]',
            'button[title*="pause"]',
            '.pause-button',
            '[data-testid="pause-button"]'
        ];

        pauseSelectors.forEach(selector => {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.click();
                console.log('[Open in mpv] Clicked pause button:', selector);
            }
        });
    }

    // ==================== Stremio Functions ====================

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
            console.error("[Open in mpv] base64UrlDecodeToUtf8 error:", e);
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
                console.error("[Open in mpv] Base64 decoding failed");
                return null;
            }

            const jsonStartMarker = '{"url":';
            let jsonStartIndex = decodedJsonString.indexOf(jsonStartMarker);
            if (jsonStartIndex === -1) {
                jsonStartIndex = decodedJsonString.indexOf('{');
            }

            if (jsonStartIndex === -1) {
                console.error('[Open in mpv] Could not find start of JSON object');
                return null;
            }

            const initialCleanedJson = decodedJsonString.substring(jsonStartIndex);
            const lastBraceIndex = initialCleanedJson.lastIndexOf('}');

            if (lastBraceIndex === -1) {
                console.error("[Open in mpv] No closing '}' found in JSON data");
                return null;
            }

            const finalCleanedJson = initialCleanedJson.substring(0, lastBraceIndex + 1);
            const streamInfo = JSON.parse(finalCleanedJson);

            if (streamInfo && streamInfo.url) {
                return {
                    url: streamInfo.url,
                    name: streamInfo.name || 'Unknown'
                };
            }

            return null;
        } catch (e) {
            console.error('[Open in mpv] Error processing video info:', e);
            return null;
        }
    }

    function getCurrentStremioStream() {
        const hash = window.location.hash;
        return extractUrlFromPlayerHash(hash);
    }

    function stopStremioPlayer() {
        // Try to find and pause/stop the video element
        const video = document.querySelector('video');
        if (video) {
            video.pause();
            console.log('[Open in mpv] Paused video player');
        }

        // Also try to click the pause button if it exists
        const pauseButton = document.querySelector('button[aria-label*="Pause"], button[title*="Pause"], .pause-button');
        if (pauseButton) {
            pauseButton.click();
            console.log('[Open in mpv] Clicked pause button');
        }
    }

    function isStremioSite() {
        const hostname = window.location.hostname;
        return hostname === 'web.stremio.com' ||
               hostname === 'app.strem.io' ||
               hostname === 'web.strem.io';
    }

    // ==================== Core Functions ====================

    function notify(message) {
        window.alert(message);
        console.log('[Open in mpv]', message);
    }

    function buildYtdlFormat(overrideAudioOnly = null) {
        // Use override if provided, otherwise use settings
        const audioOnly = overrideAudioOnly !== null ? overrideAudioOnly : settings.ytdlpAudioOnly;

        // Audio only mode takes priority
        if (audioOnly) {
            return 'bestaudio/best';
        }

        // Custom format string overrides quality presets
        if (settings.ytdlpFormat && settings.ytdlpFormat.trim() !== '') {
            return settings.ytdlpFormat.trim();
        }

        // Quality/resolution presets
        if (settings.ytdlpQuality && settings.ytdlpQuality !== '') {
            switch (settings.ytdlpQuality) {
                case 'best':
                    return 'bestvideo+bestaudio/best';
                case '2160p':
                    return 'bestvideo[height<=?2160]+bestaudio/best';
                case '1440p':
                    return 'bestvideo[height<=?1440]+bestaudio/best';
                case '1080p':
                    return 'bestvideo[height<=?1080]+bestaudio/best';
                case '720p':
                    return 'bestvideo[height<=?720]+bestaudio/best';
                case '480p':
                    return 'bestvideo[height<=?480]+bestaudio/best';
                case '360p':
                    return 'bestvideo[height<=?360]+bestaudio/best';
                case 'worst':
                    return 'worstvideo+worstaudio/worst';
            }
        }

        return null;
    }

    function buildYtdlpRawOptions() {
        const options = [];

        // Custom yt-dlp options
        if (settings.ytdlpCustomOptions && settings.ytdlpCustomOptions.trim() !== '') {
            // Parse custom options - split by comma or newline
            const customOpts = settings.ytdlpCustomOptions.trim()
                .split(/[,\n]/)
                .map(opt => opt.trim())
                .filter(opt => opt !== '');
            options.push(...customOpts);
        }

        return options;
    }

    function openInMpv(streamUrl, options = {}) {
        if (!streamUrl || streamUrl.trim() === '') {
            notify('Please enter a valid URL');
            return;
        }

        // Trim whitespace
        streamUrl = streamUrl.trim();

        // Stop browser media if enabled (and not overridden by options)
        if (settings.stopBrowserMedia && options.skipBrowserMediaStop !== true) {
            stopAllBrowserMedia();
        }

        // Encode the URL
        const encodedUrl = encodeURIComponent(streamUrl);

        // Build mpv:// protocol URL
        let mpvUrl = `mpv:///open?url=${encodedUrl}`;

        // Add optional parameters
        if (settings.fullscreen) {
            mpvUrl += '&full_screen=1';
        }

        if (settings.pip) {
            mpvUrl += '&pip=1';
        }

        if (settings.enqueue) {
            mpvUrl += '&enqueue=1';
        }

        if (settings.newWindow) {
            mpvUrl += '&new_window=1';
        }

        if (settings.player && settings.player.trim() !== '') {
            mpvUrl += `&player=${encodeURIComponent(settings.player.trim())}`;
        }

        // Build flags including yt-dlp options
        let allFlags = [];

        // Add existing custom flags
        if (settings.flags && settings.flags.trim() !== '') {
            allFlags.push(settings.flags.trim());
        }

        // Add ytdl-format flag for quality/format selection
        // Use audioOnly override if provided in options
        const ytdlFormat = buildYtdlFormat(options.audioOnly);
        if (ytdlFormat) {
            allFlags.push(`--ytdl-format=${ytdlFormat}`);
        }

        // Add yt-dlp raw options for other settings
        const ytdlpOptions = buildYtdlpRawOptions();
        if (ytdlpOptions.length > 0) {
            // Format: --ytdl-raw-options=option1=value1,option2=value2
            const ytdlpString = `--ytdl-raw-options=${ytdlpOptions.join(',')}`;
            allFlags.push(ytdlpString);
        }

        if (allFlags.length > 0) {
            mpvUrl += `&flags=${encodeURIComponent(allFlags.join(' '))}`;
        }

        console.log('[Open in mpv] Opening:', mpvUrl);

        // Try to open the mpv:// URL
        try {
            GM_openInTab(mpvUrl, {
                active: true,
                insert: true
            });

            // Run callback after opening (e.g., to pause Stremio)
            if (options.onOpen) {
                setTimeout(options.onOpen, 100);
            }
        } catch (error) {
            console.error('[Open in mpv] Error:', error);
            window.open(mpvUrl, '_blank');

            if (options.onOpen) {
                setTimeout(options.onOpen, 100);
            }
        }
    }

    function getUserInput() {
        const url = prompt('Enter URL to open in mpv:', '');
        return url;
    }

    function createSettingsPanel() {
        // Check if panel already exists
        if (document.getElementById('mpv-settings-overlay')) {
            document.getElementById('mpv-settings-overlay').style.display = 'flex';
            updateSettingsUI();
            return;
        }

        // Create overlay
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

        // Create settings panel
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

        // Header
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

        // Settings container
        const settingsContainer = document.createElement('div');
        settingsContainer.id = 'mpv-settings-container';
        settingsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        // Section header function
        function createSectionHeader(text) {
            const header = document.createElement('div');
            header.style.cssText = `
                font-size: 12px;
                font-weight: 600;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-top: 8px;
                margin-bottom: 4px;
            `;
            header.textContent = text;
            return header;
        }

        // Create toggle switch function
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
            labelEl.style.cssText = `
                font-size: 14px;
                color: #e0e0e0;
            `;

            const descEl = document.createElement('span');
            descEl.textContent = description;
            descEl.style.cssText = `
                font-size: 11px;
                color: #777;
            `;

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
            input.style.cssText = `
                opacity: 0;
                width: 0;
                height: 0;
            `;

            const slider = document.createElement('span');
            slider.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: ${settings[settingKey] ? '#4CAF50' : '#555'};
                border-radius: 26px;
                transition: 0.3s;
            `;

            const knob = document.createElement('span');
            knob.style.cssText = `
                position: absolute;
                content: "";
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
                console.log(`[Open in mpv] ${settingKey}:`, isChecked);
            };

            toggle.appendChild(input);
            toggle.appendChild(slider);

            row.appendChild(labelContainer);
            row.appendChild(toggle);

            return row;
        }

        // Create text input function
        function createTextInput(label, description, settingKey, placeholder) {
            const container = document.createElement('div');
            container.style.cssText = `
                padding: 12px 16px;
                background: #2a2a2a;
                border-radius: 8px;
            `;

            const labelContainer = document.createElement('div');
            labelContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 2px;
                margin-bottom: 10px;
            `;

            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            labelEl.style.cssText = `
                font-size: 14px;
                color: #e0e0e0;
            `;

            const descEl = document.createElement('span');
            descEl.textContent = description;
            descEl.style.cssText = `
                font-size: 11px;
                color: #777;
            `;

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
                console.log(`[Open in mpv] ${settingKey}:`, input.value);
            };

            container.appendChild(labelContainer);
            container.appendChild(input);

            return container;
        }

        // Create textarea input function
        function createTextareaInput(label, description, settingKey, placeholder, rows = 3) {
            const container = document.createElement('div');
            container.style.cssText = `
                padding: 12px 16px;
                background: #2a2a2a;
                border-radius: 8px;
            `;

            const labelContainer = document.createElement('div');
            labelContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 2px;
                margin-bottom: 10px;
            `;

            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            labelEl.style.cssText = `
                font-size: 14px;
                color: #e0e0e0;
            `;

            const descEl = document.createElement('span');
            descEl.textContent = description;
            descEl.style.cssText = `
                font-size: 11px;
                color: #777;
            `;

            labelContainer.appendChild(labelEl);
            labelContainer.appendChild(descEl);

            const textarea = document.createElement('textarea');
            textarea.value = settings[settingKey];
            textarea.placeholder = placeholder;
            textarea.dataset.setting = settingKey;
            textarea.rows = rows;
            textarea.style.cssText = `
                width: 100%;
                padding: 10px 12px;
                background: #1e1e1e;
                border: 1px solid #444;
                border-radius: 6px;
                color: #fff;
                font-size: 13px;
                font-family: monospace;
                box-sizing: border-box;
                transition: border-color 0.2s;
                resize: vertical;
                min-height: 60px;
            `;

            textarea.onfocus = () => textarea.style.borderColor = '#4CAF50';
            textarea.onblur = () => textarea.style.borderColor = '#444';

            textarea.oninput = () => {
                settings[settingKey] = textarea.value;
                GM_setValue(settingKey, textarea.value);
                console.log(`[Open in mpv] ${settingKey}:`, textarea.value);
            };

            container.appendChild(labelContainer);
            container.appendChild(textarea);

            return container;
        }

        // Create select dropdown function
        function createSelect(label, description, settingKey, options) {
            const container = document.createElement('div');
            container.style.cssText = `
                padding: 12px 16px;
                background: #2a2a2a;
                border-radius: 8px;
            `;

            const labelContainer = document.createElement('div');
            labelContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 2px;
                margin-bottom: 10px;
            `;

            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            labelEl.style.cssText = `
                font-size: 14px;
                color: #e0e0e0;
            `;

            const descEl = document.createElement('span');
            descEl.textContent = description;
            descEl.style.cssText = `
                font-size: 11px;
                color: #777;
            `;

            labelContainer.appendChild(labelEl);
            labelContainer.appendChild(descEl);

            const select = document.createElement('select');
            select.dataset.setting = settingKey;
            select.style.cssText = `
                width: 100%;
                padding: 10px 12px;
                background: #1e1e1e;
                border: 1px solid #444;
                border-radius: 6px;
                color: #fff;
                font-size: 13px;
                box-sizing: border-box;
                cursor: pointer;
                transition: border-color 0.2s;
            `;

            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                option.selected = settings[settingKey] === opt.value;
                option.style.cssText = `
                    background: #1e1e1e;
                    color: #fff;
                `;
                select.appendChild(option);
            });

            select.onfocus = () => select.style.borderColor = '#4CAF50';
            select.onblur = () => select.style.borderColor = '#444';

            select.onchange = () => {
                settings[settingKey] = select.value;
                GM_setValue(settingKey, select.value);
                console.log(`[Open in mpv] ${settingKey}:`, select.value);
            };

            container.appendChild(labelContainer);
            container.appendChild(select);

            return container;
        }

        // Playback Options Section
        settingsContainer.appendChild(createSectionHeader('Playback Options'));

        settingsContainer.appendChild(createToggle(
            'Fullscreen',
            'Start video in fullscreen mode',
            'fullscreen'
        ));

        settingsContainer.appendChild(createToggle(
            'Picture-in-Picture',
            'Start video in PiP mode (mpv only)',
            'pip'
        ));

        // Queue Options Section
        settingsContainer.appendChild(createSectionHeader('Queue Options'));

        settingsContainer.appendChild(createToggle(
            'Enqueue',
            'Add video to queue instead of playing immediately',
            'enqueue'
        ));

        settingsContainer.appendChild(createToggle(
            'New Window',
            'Force video to open in a new window',
            'newWindow'
        ));

        // Browser Options Section
        settingsContainer.appendChild(createSectionHeader('Browser Options'));

        settingsContainer.appendChild(createToggle(
            'Stop Browser Media',
            'Pause all video/audio in browser when opening in mpv',
            'stopBrowserMedia'
        ));

        // yt-dlp Options Section
        settingsContainer.appendChild(createSectionHeader('yt-dlp Options'));

        settingsContainer.appendChild(createSelect(
            'Video Quality',
            'Maximum resolution for video playback',
            'ytdlpQuality',
            [
                { value: '', label: 'Default (best available)' },
                { value: 'best', label: 'Best' },
                { value: 'worst', label: 'Worst (save bandwidth)' }
            ]
        ));

        settingsContainer.appendChild(createToggle(
            'Audio Only',
            'Extract and play audio only (no video)',
            'ytdlpAudioOnly'
        ));

        settingsContainer.appendChild(createTextInput(
            'Custom Format',
            'yt-dlp format string (overrides quality preset)',
            'ytdlpFormat',
            'e.g., bestvideo[ext=mp4]+bestaudio[ext=m4a]'
        ));

        settingsContainer.appendChild(createTextareaInput(
            'Custom yt-dlp Options',
            'Additional yt-dlp options (one per line or comma-separated)',
            'ytdlpCustomOptions',
            'e.g., cookies-from-browser=firefox\nno-playlist=\nage-limit=18'
        ));

        // Stremio Options Section
        settingsContainer.appendChild(createSectionHeader('Stremio Options'));

        settingsContainer.appendChild(createToggle(
            'Pause on Open',
            'Pause Stremio player when opening stream in mpv',
            'stremioPauseOnOpen'
        ));

        // Advanced Options Section
        settingsContainer.appendChild(createSectionHeader('Advanced Options'));

        settingsContainer.appendChild(createTextInput(
            'Player',
            'Specify a different video player (leave empty for mpv)',
            'player',
            'e.g., celluloid, vlc, iina'
        ));

        settingsContainer.appendChild(createTextInput(
            'Custom Flags',
            'Additional mpv command-line flags',
            'flags',
            'e.g., --vo=gpu --hwdec=auto'
        ));

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = `
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
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
        resetBtn.onmouseover = () => {
            resetBtn.style.borderColor = '#666';
            resetBtn.style.color = '#fff';
        };
        resetBtn.onmouseout = () => {
            resetBtn.style.borderColor = '#444';
            resetBtn.style.color = '#888';
        };
        resetBtn.onclick = () => {
            if (confirm('Reset all settings to defaults?')) {
                settings = {
                    fullscreen: true,
                    pip: false,
                    enqueue: false,
                    newWindow: false,
                    player: '',
                    flags: '',
                    stremioPauseOnOpen: true,
                    stopBrowserMedia: true,
                    ytdlpQuality: '',
                    ytdlpAudioOnly: false,
                    ytdlpFormat: '',
                    ytdlpCustomOptions: ''
                };

                // Save defaults
                Object.keys(settings).forEach(key => {
                    GM_setValue(key, settings[key]);
                });

                // Update UI
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

        // Assemble panel
        panel.appendChild(header);
        panel.appendChild(settingsContainer);
        panel.appendChild(footer);
        overlay.appendChild(panel);

        // Close on overlay click (but not panel click)
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        };

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display === 'flex') {
                overlay.style.display = 'none';
            }
        });

        document.body.appendChild(overlay);
    }

    function updateSettingsUI() {
        const container = document.getElementById('mpv-settings-container');
        if (!container) return;

        // Update toggles
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

        // Update text inputs
        container.querySelectorAll('input[type="text"]').forEach(input => {
            const key = input.dataset.setting;
            if (key && settings.hasOwnProperty(key)) {
                input.value = settings[key];
            }
        });

        // Update textareas
        container.querySelectorAll('textarea').forEach(textarea => {
            const key = textarea.dataset.setting;
            if (key && settings.hasOwnProperty(key)) {
                textarea.value = settings[key];
            }
        });

        // Update selects
        container.querySelectorAll('select').forEach(select => {
            const key = select.dataset.setting;
            if (key && settings.hasOwnProperty(key)) {
                select.value = settings[key];
            }
        });
    }

    // ==================== Menu Commands ====================

    // Register menu command to open user-input URL in mpv
    GM_registerMenuCommand('🔗 Open URL in mpv', () => {
        const url = getUserInput();
        if (url) {
            openInMpv(url);
        }
    });

    // Register menu command to open current page URL in mpv
    GM_registerMenuCommand('▶️ Open in mpv', () => {
        openInMpv(window.location.href);
    });

    // Register menu command to open current page as audio only
    GM_registerMenuCommand('🎵 Open as audio in mpv', () => {
        openInMpv(window.location.href, { audioOnly: true });
    });

    // Register Stremio-specific menu command only on Stremio sites
    if (isStremioSite()) {
        GM_registerMenuCommand('🎬 Play current Stremio stream', () => {
            const stream = getCurrentStremioStream();
            if (stream) {
                console.log('[Open in mpv] Opening Stremio stream:', stream.name);
                openInMpv(stream.url, {
                    onOpen: settings.stremioPauseOnOpen ? stopStremioPlayer : null
                });
            } else {
                notify('No active stream found. Please navigate to a player page first.');
            }
        });
    }

    // Register menu command to open settings
    GM_registerMenuCommand('⚙️ Settings', () => {
        createSettingsPanel();
    });

})();
