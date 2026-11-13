// ==UserScript==
// @name         TweetCap
// @namespace    https://github.com/tweetcap
// @version      1.0.2
// @description  Recreate tweets as clean images and download original video media.
// @match        https://twitter.com/*
// @match        https://x.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @require      https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      video-cf.twimg.com
// @connect      *.twimg.com
// @connect      abs.twimg.com
// @connect      cdn.jsdelivr.net
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const MENU_LABEL = 'Recreate tweet';
    const STYLE_ID = 'tweetcap-styles';
    let lastArticle = null;
    let lastMoreClick = 0;
    let dialog = null;
    let selectedMedia = 0;
    let dialogTheme = localStorage.getItem('tweetcap-theme') || 'light';
    let gifWorkerUrlPromise = null;
    let dialogResizeHandler = null;

    const css = `
        #tweetcap-dialog { --tc-bg: #fff; --tc-text: #17202a; --tc-muted: #536471; --tc-border: #cfd9de; border: 0; border-radius: 14px; padding: 0; margin: auto; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow: hidden; color: var(--tc-text); background: var(--tc-bg); box-shadow: 0 18px 70px #0008; font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        #tweetcap-dialog[data-theme="dark"] { --tc-bg: #15202b; --tc-text: #f7f9f9; --tc-muted: #8b98a5; --tc-border: #38444d; }
        #tweetcap-dialog::backdrop { background: #0008; }
        #tweetcap-dialog .tc-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--tc-border); }
        #tweetcap-dialog .tc-head-actions { display: flex; align-items: center; gap: 12px; }
        #tweetcap-dialog h2 { margin: 0; font-size: 19px; }
        #tweetcap-dialog .tc-close, #tweetcap-dialog .tc-theme { border: 0; background: transparent; color: var(--tc-muted); cursor: pointer; }
        #tweetcap-dialog .tc-close { font-size: 25px; line-height: 1; }
        #tweetcap-dialog .tc-theme { font-size: 14px; font-weight: 700; }
        #tweetcap-dialog .tc-body { overflow: hidden; padding: 20px; }
        #tweetcap-dialog .tc-actions { display: flex; gap: 10px; margin-top: 16px; }
        #tweetcap-dialog .tc-actions button, #tweetcap-dialog .tc-choice { border: 1px solid #1d9bf0; border-radius: 999px; padding: 9px 15px; background: #1d9bf0; color: white; font-weight: 700; cursor: pointer; }
        #tweetcap-dialog .tc-actions button[disabled] { opacity: .5; cursor: not-allowed; }
        #tweetcap-dialog .tc-actions .tc-secondary { background: var(--tc-bg); color: #1d9bf0; }
        #tweetcap-dialog .tc-picker { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
        #tweetcap-dialog .tc-choice { padding: 6px 11px; background: white; color: #536471; }
        #tweetcap-dialog .tc-choice[aria-pressed="true"] { background: #1d9bf0; color: white; }
        .tc-card { overflow: hidden; border: 1px solid var(--tc-border); border-radius: 14px; background: var(--tc-bg); }
        .tc-preview { display: flex; justify-content: center; overflow: auto; }
        .tc-rendered { display: block; width: auto; max-width: 100%; height: auto; border: 1px solid var(--tc-border); border-radius: 12px; }
        .tc-card-inner { padding: 18px; }
        .tc-author { display: flex; align-items: center; gap: 10px; }
        .tc-avatar { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: #e6ecf0; }
        .tc-name { font-weight: 700; color: var(--tc-text); }
        .tc-handle, .tc-date, .tc-stats { color: var(--tc-muted); }
        .tc-text { margin: 16px 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 18px; line-height: 1.4; }
        .tc-media { display: block; width: 100%; height: auto; max-height: 510px; object-fit: contain; border: 1px solid var(--tc-border); border-radius: 12px; background: #e6ecf0; }
        .tc-video { display: block; width: 100%; height: auto; max-height: 510px; border: 1px solid var(--tc-border); border-radius: 12px; background: #000; }
        .tc-meta { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; font-size: 13px; }
        .tc-info { display: flex; flex-wrap: wrap; gap: 12px; color: var(--tc-muted); }
        .tc-info span:last-child { font-weight: 700; }
        .tc-stats { display: flex; flex-wrap: wrap; gap: 12px; }
        .tc-stat { display: inline-flex; align-items: center; gap: 4px; }
        .tc-stat-icon { width: 15px; height: 15px; fill: currentColor; }
    `;

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function textOf(element) {
        return element ? element.textContent.trim() : '';
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    }

    function formatStat(label) {
        const value = String(label || '').replace(/\s+(repl(?:y|ies)|repost|like|bookmark|view)s?\.?$/i, '').trim();
        if (/repl/i.test(label)) return { type: 'reply', value };
        if (/repost/i.test(label)) return { type: 'repost', value };
        if (/like/i.test(label)) return { type: 'like', value };
        if (/bookmark/i.test(label)) return { type: 'bookmark', value };
        if (/view/i.test(label)) return { type: 'view', value };
        return { type: 'stat', value: label };
    }

    function statIcon(type) {
        return `<svg class="tc-stat-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${statPath(type)}"></path></svg>`;
    }

    function statPath(type) {
        const paths = {
            reply: 'M1.75 10a8 8 0 0 1 8-8h4.37a8.13 8.13 0 0 1 3.93 15.24L10 21.7V18h-.07a8 8 0 0 1-8.18-8m2 0a6 6 0 0 0 6.14 6H12v2.3l5.09-2.8A6.13 6.13 0 0 0 14.12 4H9.75a6 6 0 0 0-6 6',
            repost: 'M13.1 4q1.65-.01 2.71.06c.73.06 1.37.18 1.96.48a5 5 0 0 1 2.19 2.19 5 5 0 0 1 .48 1.96q.08 1.06.06 2.71v5.05l2.07-1.93 1.36 1.46-4.43 4.14-4.43-4.14 1.36-1.46 2.07 1.93V11.4c0-1.14 0-1.93-.05-2.55a3 3 0 0 0-.27-1.21 3 3 0 0 0-1.32-1.31 3 3 0 0 0-1.21-.28C15.03 6 14.24 6 13.1 6H11V4zM8.93 8.02 7.57 9.48 5.5 7.55v5.05c0 1.14 0 1.93.05 2.55.05.6.15.95.28 1.21a3 3 0 0 0 1.31 1.31c.26.14.61.23 1.22.28s1.4.05 2.54.05H13v2h-2.1q-1.64.02-2.7-.06a5 5 0 0 1-1.97-.48 5 5 0 0 1-2.18-2.19 5 5 0 0 1-.49-1.96q-.08-1.06-.06-2.7V7.54L1.43 9.48.07 8.02 4.5 3.88z',
            like: 'M17.06 3a5.7 5.7 0 0 1 4.81 3.16c.94 1.9.89 4.36-.54 6.98-1.42 2.61-4.2 5.4-8.83 8.09l-.5.29-.5-.3c-4.62-2.68-7.4-5.47-8.83-8.08S1.2 8.05 2.13 6.16a5.7 5.7 0 0 1 4.8-3.15c1.75-.09 3.56.6 5.07 2.15a6.6 6.6 0 0 1 5.06-2.15m-.1 2c-1.3-.06-2.86.55-4.15 2.3L12 8.4l-.81-1.1C9.9 5.55 8.35 4.94 7.04 5a3.7 3.7 0 0 0-3.12 2.05c-.6 1.2-.67 2.97.5 5.14 1.15 2.1 3.47 4.53 7.58 7 4.1-2.47 6.43-4.9 7.57-7 1.18-2.17 1.1-3.94.5-5.14A3.7 3.7 0 0 0 16.98 5',
            bookmark: 'M18.5 7c0-.72 0-1.2-.03-1.56a2 2 0 0 0-.13-.62 1.5 1.5 0 0 0-.66-.66c-.1-.05-.26-.1-.62-.13S16.22 4 15.5 4h-7c-.72 0-1.2 0-1.56.03s-.52.08-.62.13a1.5 1.5 0 0 0-.66.66c-.05.1-.1.26-.13.62-.03.37-.03.84-.03 1.56v11.33l6.5-3.46 6.5 3.46zm2 14.67L12 17.13l-8.5 4.54V7q-.01-1.03.04-1.72c.04-.48.12-.94.34-1.37a3.5 3.5 0 0 1 1.53-1.53c.43-.22.89-.3 1.37-.34q.7-.05 1.72-.04h7q1.02-.01 1.72.04c.48.04.94.12 1.37.34.66.34 1.2.87 1.53 1.53.22.43.3.89.34 1.37q.05.7.04 1.72z',
            view: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
            stat: 'M4 4h16v16H4z'
        };
        return paths[type] || paths.stat;
    }

    function statMarkup(label) {
        const stat = formatStat(label);
        if (stat.type === 'view') return '';
        return `<span class="tc-stat">${statIcon(stat.type)}<span>${escapeHtml(stat.value)}</span></span>`;
    }

    function viewMarkup(tweet) {
        const value = viewValue(tweet);
        return value ? `${escapeHtml(value)} Views` : '';
    }

    function viewValue(tweet) {
        return tweet.stats.map(formatStat).find(stat => stat.type === 'view')?.value || '';
    }

    function originalMediaUrl(url) {
        if (!url) return '';
        const cleaned = url.replace(/[?&]name=[^&]+/, '').replace(/[?&]format=[^&]+/, '');
        return /pbs\.twimg\.com\/media\//.test(cleaned) && !cleaned.includes('?') ? `${cleaned}?format=jpg&name=large` : cleaned;
    }

    function extractTweet(article) {
        const profileLinks = [...article.querySelectorAll('a[href^="/"]')]
            .filter(link => /^\/[A-Za-z0-9_]+$/.test(link.getAttribute('href')));
        const authorLink = profileLinks.find(link => /^@/.test(textOf(link))) || profileLinks.find(link => textOf(link));
        const profilePath = authorLink?.getAttribute('href') || '';
        const name = textOf(article.querySelector('[data-testid="User-Name"]')) || textOf(profileLinks.find(link => link.getAttribute('href') === profilePath && textOf(link) && !/^@/.test(textOf(link)))) || textOf(authorLink);
        const handle = authorLink ? `@${authorLink.getAttribute('href').slice(1)}` : '';
        const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"] img, [data-post-avatar="true"] img, img[src*="profile_images"]')?.src || '';
        const text = textOf(article.querySelector('[data-testid="tweetText"], [class*="whitespace-pre-wrap"]'));
        const time = article.querySelector('time');
        const dateLink = [...article.querySelectorAll('a[href*="/status/"]')].find(link => !link.getAttribute('href').includes('/analytics') && textOf(link));
        const date = time?.getAttribute('datetime') || dateLink?.getAttribute('href') || '';
        const dateLabel = time?.textContent.trim() || textOf(dateLink);
        const engagementLabel = article.querySelector('[role="group"][aria-label]')?.getAttribute('aria-label') || '';
        const stats = (engagementLabel ? engagementLabel.split(/,\s*/) : [...article.querySelectorAll('[role="button"][aria-label], button[aria-label]')].map(button => button.getAttribute('aria-label')))
            .filter(label => /repl|repost|like|view|bookmark/i.test(label || ''))
            .filter((label, index, values) => values.indexOf(label) === index);
        const media = [];
        const seen = new Set();
        article.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]').forEach(image => {
            const url = originalMediaUrl(image.currentSrc || image.src);
            if (url && !seen.has(url)) {
                seen.add(url);
                media.push({ kind: 'image', url, alt: image.alt || 'Tweet image' });
            }
        });
        article.querySelectorAll('video').forEach(video => {
            const url = originalMediaUrl(video.querySelector('source')?.src || video.currentSrc || video.src);
            const poster = originalMediaUrl(video.poster || '');
            if (url && !seen.has(url)) {
                seen.add(url);
                const kind = /\.gif(?:[?#]|$)/i.test(url) || /\.gif(?:[?#]|$)/i.test(poster) || /\/tweet_video\//i.test(url) || /tweet_video_thumb/i.test(poster) ? 'gif' : 'video';
                    media.push({ kind, url, poster, element: video, alt: kind === 'gif' ? 'Tweet GIF' : 'Tweet video' });
            }
        });
        return { name, handle, avatar, text, date, dateLabel, stats, media };
    }

    function closeDialog() {
        if (dialog) dialog.close();
    }

    function fitDialogToCanvas(canvas) {
        const availableWidth = Math.max(240, window.innerWidth - 64);
        const availableHeight = Math.max(160, window.innerHeight - 190);
        const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 1);
        const renderedWidth = Math.round(canvas.width * scale);
        const renderedHeight = Math.round(canvas.height * scale);
        canvas.style.width = `${renderedWidth}px`;
        canvas.style.height = `${renderedHeight}px`;
        dialog.style.width = `${Math.min(renderedWidth + 40, window.innerWidth - 32)}px`;
    }

    function mediaMarkup(tweet) {
        const item = tweet.media[selectedMedia];
        if (!item) return '';
        if (item.kind === 'video' || item.kind === 'gif') {
            return `<video class="tc-video" controls preload="metadata"${item.kind === 'gif' ? ' autoplay loop muted playsinline' : ''}${item.poster ? ` poster="${escapeHtml(item.poster)}"` : ''} src="${escapeHtml(item.url)}"></video>`;
        }
        return `<img class="tc-media" src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt)}">`;
    }

    function cardMarkup(tweet) {
        const stats = tweet.stats.map(statMarkup).join('');
        return `<article class="tc-card"><div class="tc-card-inner">
            <div class="tc-author"><img class="tc-avatar" src="${escapeHtml(tweet.avatar)}" alt=""><div><div class="tc-name">${escapeHtml(tweet.name)}</div><div class="tc-handle">${escapeHtml(tweet.handle)}</div></div></div>
            <div class="tc-text">${escapeHtml(tweet.text)}</div>${mediaMarkup(tweet)}
            <div class="tc-meta"><div class="tc-info"><span class="tc-date">${escapeHtml(tweet.dateLabel)}</span><span>${viewMarkup(tweet)}</span></div><div class="tc-stats">${stats}</div></div>
        </div></article>`;
    }

    function openTweetDialog(article) {
        const tweet = extractTweet(article);
        selectedMedia = 0;
        installStyle();
        if (dialogResizeHandler) window.removeEventListener('resize', dialogResizeHandler);
        if (dialog) dialog.remove();
        dialog = document.createElement('dialog');
        dialog.id = 'tweetcap-dialog';
        dialog.dataset.theme = dialogTheme;
        dialog.innerHTML = `<div class="tc-head"><h2>Recreated tweet</h2><div class="tc-head-actions"><button class="tc-theme" type="button"></button><button class="tc-close" type="button" aria-label="Close">&times;</button></div></div><div class="tc-body"><div class="tc-picker" hidden></div><div class="tc-preview"></div><div class="tc-actions"><button class="tc-copy" type="button">Copy image</button><button class="tc-download tc-secondary" type="button">Download image</button></div></div>`;
        document.body.appendChild(dialog);
        const picker = dialog.querySelector('.tc-picker');
        const preview = dialog.querySelector('.tc-preview');
        const copyButton = dialog.querySelector('.tc-copy');
        const downloadButton = dialog.querySelector('.tc-download');
        const themeButton = dialog.querySelector('.tc-theme');
        dialogResizeHandler = () => {
            const canvas = preview.querySelector('canvas');
            if (canvas) fitDialogToCanvas(canvas);
        };
        window.addEventListener('resize', dialogResizeHandler);
        dialog.addEventListener('close', () => {
            if (dialogResizeHandler) window.removeEventListener('resize', dialogResizeHandler);
            dialogResizeHandler = null;
        }, { once: true });
        const updateTheme = () => {
            dialog.dataset.theme = dialogTheme;
            themeButton.textContent = dialogTheme === 'dark' ? 'Light mode' : 'Dark mode';
            themeButton.setAttribute('aria-label', `Switch to ${dialogTheme === 'dark' ? 'light' : 'dark'} mode`);
        };
        let renderToken = 0;
        const render = async () => {
            const token = ++renderToken;
            preview.innerHTML = '<span class="tc-loading">Rendering...</span>';
            const isVideo = tweet.media[selectedMedia]?.kind === 'video';
            copyButton.hidden = isVideo;
            copyButton.textContent = tweet.media[selectedMedia]?.kind === 'gif' ? 'Copy GIF' : 'Copy image';
            downloadButton.textContent = isVideo ? 'Download video' : tweet.media[selectedMedia]?.kind === 'gif' ? 'Download GIF' : 'Download image';
            try {
                const canvas = await renderPreviewCanvas(tweet);
                if (token !== renderToken) return;
                canvas.className = 'tc-rendered';
                preview.replaceChildren(canvas);
                fitDialogToCanvas(canvas);
            } catch (error) {
                if (token === renderToken) preview.textContent = 'Preview failed';
                console.error('TweetCap preview failed', error);
            }
        };
        if (tweet.media.length > 1) {
            picker.hidden = false;
            tweet.media.forEach((item, index) => {
                const button = document.createElement('button');
                button.className = 'tc-choice';
                button.type = 'button';
                button.textContent = `Media ${index + 1}`;
                button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
                button.addEventListener('click', () => {
                    selectedMedia = index;
                    picker.querySelectorAll('button').forEach(choice => choice.setAttribute('aria-pressed', choice === button ? 'true' : 'false'));
                    render();
                });
                picker.appendChild(button);
            });
        }
        dialog.querySelector('.tc-close').addEventListener('click', closeDialog);
        themeButton.addEventListener('click', () => {
            dialogTheme = dialogTheme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('tweetcap-theme', dialogTheme);
            updateTheme();
            render();
        });
        dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
        copyButton.addEventListener('click', async () => {
            copyButton.disabled = true;
            try {
                const item = tweet.media[selectedMedia];
                if (item?.kind === 'gif') {
                    // Clipboard implementations commonly reject animated image/gif items.
                    const firstFrame = await renderPreviewCanvas(tweet);
                    const pngBlob = await canvasBlob(firstFrame, 'image/png');
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                    copyButton.textContent = 'Copied';
                    return;
                }
                const blob = await renderImage(tweet);
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                copyButton.textContent = 'Copied';
            } catch (error) {
                copyButton.textContent = 'Copy failed';
                console.error('TweetCap copy failed', error);
            } finally {
                setTimeout(() => { copyButton.disabled = false; copyButton.textContent = 'Copy image'; }, 1800);
            }
        });
        downloadButton.addEventListener('click', async () => {
            const item = tweet.media[selectedMedia];
            if (item?.kind === 'video' || item?.kind === 'gif') {
                downloadButton.disabled = true;
                try {
                    const blob = await captureAnimatedTweet(tweet, item.kind === 'gif');
                    downloadBlob(blob, `tweet-${Date.now()}.${item.kind === 'gif' ? 'gif' : 'webm'}`);
                } catch (error) {
                    console.error('TweetCap animated export failed', error);
                } finally {
                    downloadButton.disabled = false;
                }
                return;
            }
            downloadButton.disabled = true;
            try {
                const blob = await renderImage(tweet);
                downloadBlob(blob, `tweet-${Date.now()}.png`);
            } catch (error) {
                console.error('TweetCap download failed', error);
            } finally {
                downloadButton.disabled = false;
            }
        });
        updateTheme();
        render();
        dialog.showModal();
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const finish = (blobUrl) => {
                const image = new Image();
                image.onload = () => { URL.revokeObjectURL(blobUrl); resolve(image); };
                image.onerror = (error) => { URL.revokeObjectURL(blobUrl); reject(error); };
                image.src = blobUrl;
            };
            if (typeof GM_xmlhttpRequest === 'function') {
                requestMediaBlob(url).then(blob => finish(URL.createObjectURL(blob))).catch(reject);
                return;
            }
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = url;
        });
    }

    function loadVideo(url, nativeVideo) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'auto';
            if (nativeVideo && nativeVideo.readyState >= 2 && (nativeVideo.currentSrc === url || nativeVideo.src === url)) {
                if (nativeVideo.currentSrc.startsWith('blob:')) {
                    loadVideoDirect(nativeVideo.currentSrc, video, resolve, reject);
                } else {
                    resolve({ video: nativeVideo, blobUrl: '', nativeState: snapshotVideoState(nativeVideo) });
                }
                return;
            }
            const finish = (blobUrl) => {
                video.onloadeddata = () => resolve({ video, blobUrl });
                video.onerror = reject;
                video.src = blobUrl;
                video.load();
            };
            if (typeof GM_xmlhttpRequest === 'function') {
                requestMediaBlob(url).then(blob => finish(URL.createObjectURL(blob))).catch(() => loadNativeOrDirectVideo(url, nativeVideo, video, resolve, reject));
                return;
            }
            loadNativeOrDirectVideo(url, nativeVideo, video, resolve, reject);
        });
    }

    function loadNativeOrDirectVideo(url, nativeVideo, video, resolve, reject) {
        if (nativeVideo && nativeVideo.readyState >= 2 && (nativeVideo.currentSrc === url || nativeVideo.src === url)) {
            if (nativeVideo.currentSrc.startsWith('blob:')) {
                loadVideoDirect(nativeVideo.currentSrc, video, resolve, reject);
            } else {
                resolve({ video: nativeVideo, blobUrl: '', nativeState: snapshotVideoState(nativeVideo) });
            }
            return;
        }
        loadVideoDirect(url, video, resolve, reject);
    }

    function snapshotVideoState(video) {
        return { currentTime: video.currentTime, paused: video.paused, muted: video.muted, loop: video.loop };
    }

    function restoreVideoState(video, state) {
        if (!state) {
            video.pause();
            return;
        }
        video.currentTime = state.currentTime;
        video.muted = state.muted;
        video.loop = state.loop;
        if (!state.paused) video.play().catch(() => {});
    }

    function loadVideoDirect(url, video, resolve, reject) {
        video.onloadeddata = () => resolve({ video, blobUrl: '' });
        video.onerror = reject;
        video.src = url;
        video.load();
    }

    function requestMediaBlob(url) {
        return requestMediaResponse(url, 'blob').catch(() => requestMediaResponse(url, 'arraybuffer'));
    }

    function requestMediaResponse(url, responseType) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType,
                timeout: 30000,
                headers: { Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8' },
                onload: response => {
                    if (response.status < 200 || response.status >= 400 || !response.response) {
                        reject(new Error(`Media request failed: ${response.status}`));
                        return;
                    }
                    if (responseType === 'blob' && response.response instanceof Blob) {
                        resolve(response.response);
                        return;
                    }
                    const contentType = response.responseHeaders?.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'video/mp4';
                    resolve(new Blob([response.response], { type: contentType }));
                },
                ontimeout: () => reject(new Error('Media request timed out')),
                onerror: reject
            });
        });
    }

    function canvasBlob(canvas, type) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')), type);
        });
    }

    function loadGifWorkerUrl() {
        if (gifWorkerUrlPromise) return gifWorkerUrlPromise;
        const workerUrl = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js';
        gifWorkerUrlPromise = new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest is required to load the GIF encoder worker'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: workerUrl,
                onload: response => {
                    if (response.status < 200 || response.status >= 400) {
                        reject(new Error(`GIF worker request failed: ${response.status}`));
                        return;
                    }
                    resolve(URL.createObjectURL(new Blob([response.responseText], { type: 'application/javascript' })));
                },
                onerror: reject
            });
        });
        return gifWorkerUrlPromise;
    }

    function seekVideo(video, time) {
        if (Math.abs(video.currentTime - time) < 0.01) return Promise.resolve();
        return new Promise(resolve => {
            video.onseeked = resolve;
            video.currentTime = time;
        });
    }

    function wrapText(context, value, maxWidth) {
        const lines = [];
        value.split('\n').forEach(paragraph => {
            let line = '';
            paragraph.split(/\s+/).forEach(word => {
                const candidate = line ? `${line} ${word}` : word;
                if (context.measureText(candidate).width > maxWidth && line) {
                    lines.push(line);
                    line = word;
                } else line = candidate;
            });
            lines.push(line);
        });
        return lines.length ? lines : [''];
    }

    function wrapTextRuns(context, value, maxWidth) {
        const lines = [];
        value.split('\n').forEach(paragraph => {
            const segments = paragraph.split(/(@[A-Za-z0-9_]+)/g).filter(Boolean);
            let line = [];
            let lineWidth = 0;
            segments.forEach(segment => {
                const isHandle = /^@[A-Za-z0-9_]+$/.test(segment);
                const parts = isHandle ? [segment] : segment.split(/(\s+)/).filter(Boolean);
                parts.forEach(part => {
                    const width = context.measureText(part).width;
                    if (!/^\s+$/.test(part) && line.length && lineWidth + width > maxWidth) {
                        lines.push(line);
                        line = [];
                        lineWidth = 0;
                    }
                    if (/^\s+$/.test(part) && !line.length) return;
                    line.push({ text: part, handle: isHandle });
                    lineWidth += width;
                });
            });
            lines.push(line.length ? line : [{ text: '', handle: false }]);
        });
        return lines.length ? lines : [[{ text: '', handle: false }]];
    }

    function drawTextRuns(context, lines, x, firstBaseline, dark) {
        lines.forEach((line, lineIndex) => {
            let offset = x;
            line.forEach(run => {
                context.fillStyle = run.handle ? '#1d9bf0' : (dark ? '#f7f9f9' : '#17202a');
                context.fillText(run.text, offset, firstBaseline + lineIndex * 43);
                offset += context.measureText(run.text).width;
            });
        });
    }

    function fitMedia(source, maxWidth, maxHeight) {
        const sourceWidth = source.videoWidth || source.naturalWidth || source.width || maxWidth;
        const sourceHeight = source.videoHeight || source.naturalHeight || source.height || maxHeight;
        const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
        return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
    }

    function exportWidth(mediaBox, tweet) {
        const probe = document.createElement('canvas').getContext('2d');
        probe.font = '24px Arial';
        const stats = tweet.stats.map(formatStat).filter(stat => stat.type !== 'view');
        const statsWidth = stats.reduce((sum, stat) => sum + probe.measureText(` ${stat.value}`).width + 25, 0) + Math.max(0, stats.length - 1) * 12 + 84;
        return Math.min(1200, Math.max(mediaBox ? mediaBox.width + 80 : 640, statsWidth));
    }

    function drawMedia(context, source, x, y, width, height, dark) {
        const radius = 14;
        context.save();
        context.beginPath();
        context.roundRect(x, y, width, height, radius);
        context.clip();
        context.fillStyle = dark ? '#0b1117' : '#e6ecf0';
        context.fillRect(x, y, width, height);
        context.drawImage(source, x, y, width, height);
        context.restore();
        context.save();
        context.beginPath();
        context.roundRect(x + 0.5, y + 0.5, width - 1, height - 1, radius);
        context.strokeStyle = dark ? '#38444d' : '#cfd9de';
        context.lineWidth = 1;
        context.stroke();
        context.restore();
    }

    function drawFooter(context, canvas, tweet, dark) {
        context.fillStyle = dark ? '#8b98a5' : '#536471';
        context.font = '22px Arial';
        context.fillText(tweet.dateLabel, 42, canvas.height - 52);
        const view = viewValue(tweet);
        if (view) {
            const dateWidth = context.measureText(tweet.dateLabel).width;
            context.fillText('·', 42 + dateWidth + 12, canvas.height - 52);
            const viewX = 42 + dateWidth + 28;
            context.fillStyle = '#ffffff';
            context.font = '700 22px Arial';
            context.fillText(view, viewX, canvas.height - 52);
            context.fillStyle = dark ? '#f7f9f9' : '#ffffff';
            context.font = '22px Arial';
            context.fillText(' Views', viewX + context.measureText(view).width, canvas.height - 52);
        }
        const stats = tweet.stats.map(formatStat).filter(stat => stat.type !== 'view');
        context.font = '24px Arial';
        const statWidths = stats.map(stat => context.measureText(` ${stat.value}`).width + 25);
        const totalWidth = statWidths.reduce((sum, width) => sum + width, 0);
        const spacing = stats.length > 1 ? Math.max(12, (canvas.width - 84 - totalWidth) / (stats.length - 1)) : 0;
        let statX = 42;
        stats.forEach((stat, index) => {
            const icon = new Path2D(statPath(stat.type));
            context.save();
            context.translate(statX, canvas.height - 37);
            context.scale(0.9, 0.9);
            context.fill(icon);
            context.restore();
            const text = ` ${stat.value}`;
            context.fillText(text, statX + 25, canvas.height - 17);
            statX += statWidths[index] + spacing;
        });
    }

    function drawTweetFrame(context, canvas, tweet, avatarImage, video, mediaBox) {
        const dark = dialogTheme === 'dark';
        context.font = '30px Arial';
        const textLines = wrapTextRuns(context, tweet.text || '', canvas.width - 80);
        context.fillStyle = dark ? '#15202b' : '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (avatarImage) {
            context.save();
            context.beginPath();
            context.arc(72, 60, 32, 0, Math.PI * 2);
            context.clip();
            context.drawImage(avatarImage, 40, 28, 64, 64);
            context.restore();
        }
        context.fillStyle = dark ? '#f7f9f9' : '#0f1419';
        context.font = '700 30px Arial';
        context.fillText(tweet.name || 'Unknown user', 122, 55);
        context.fillStyle = dark ? '#8b98a5' : '#536471';
        context.font = '24px Arial';
        context.fillText(tweet.handle, 122, 90);
        context.fillStyle = dark ? '#f7f9f9' : '#17202a';
        context.font = '30px Arial';
        drawTextRuns(context, textLines, 42, 145, dark);
        if (video) drawMedia(context, video, (canvas.width - mediaBox.width) / 2, 148 + textLines.length * 43, mediaBox.width, mediaBox.height, dark);
        drawFooter(context, canvas, tweet, dark);
    }

    async function captureAnimatedTweet(tweet, asGif) {
        const item = tweet.media[selectedMedia];
        if (!item || (item.kind !== 'gif' && item.kind !== 'video')) throw new Error('No animated media selected');
        const [{ video, blobUrl, nativeState }, avatarImage] = await Promise.all([
            loadVideo(item.url, item.element),
            tweet.avatar ? loadImage(tweet.avatar).catch(() => null) : Promise.resolve(null)
        ]);
        const mediaBox = fitMedia(video, 1120, 620);
        const canvas = document.createElement('canvas');
        canvas.width = exportWidth(mediaBox, tweet);
        const measureContext = canvas.getContext('2d');
        measureContext.font = '30px Arial';
        const textLines = wrapText(measureContext, tweet.text || '', canvas.width - 80);
        canvas.height = 148 + textLines.length * 43 + mediaBox.height + 80;
        const context = canvas.getContext('2d');
        context.font = '30px Arial';
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(video.duration, 60) : 5;
        const frameRate = 15;

        try {
            if (asGif) {
                if (typeof GIF !== 'function') throw new Error('GIF encoder is unavailable');
                const workerScript = await loadGifWorkerUrl();
                const encoder = new GIF({ workers: 2, quality: 10, width: canvas.width, height: canvas.height, workerScript });
                const frameCount = Math.max(1, Math.ceil(duration * frameRate));
                for (let index = 0; index < frameCount; index += 1) {
                    await seekVideo(video, Math.min(index / frameRate, Math.max(0, duration - 0.01)));
                    drawTweetFrame(context, canvas, tweet, avatarImage, video, mediaBox);
                    encoder.addFrame(canvas, { copy: true, delay: 1000 / frameRate });
                }
                return await new Promise((resolve, reject) => {
                    encoder.on('finished', resolve);
                    encoder.on('abort', () => reject(new Error('GIF encoding aborted')));
                    encoder.render();
                });
            }

            const canvasStream = canvas.captureStream(frameRate);
            const sourceStream = video.captureStream();
            sourceStream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
            const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
            if (!mimeType) throw new Error('This browser cannot record video');
            const recorder = new MediaRecorder(canvasStream, { mimeType });
            const chunks = [];
            recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            const finished = new Promise((resolve, reject) => {
                recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
                recorder.onerror = event => reject(event.error || new Error('Video recording failed'));
            });
            video.muted = false;
            video.loop = false;
            video.currentTime = 0;
            recorder.start(250);
            let stopTimer;
            const stopRecording = () => {
                if (recorder.state === 'recording') recorder.stop();
                if (stopTimer) clearTimeout(stopTimer);
            };
            video.addEventListener('ended', stopRecording, { once: true });
            stopTimer = setTimeout(stopRecording, (duration + 1) * 1000);
            await video.play();
            const draw = () => {
                drawTweetFrame(context, canvas, tweet, avatarImage, video, mediaBox);
                if (recorder.state === 'recording') requestAnimationFrame(draw);
            };
            draw();
            return await finished;
        } finally {
            if (!video.isConnected || video !== item.element) video.pause();
            else restoreVideoState(video, nativeState);
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        }
    }

    function createTweetCanvas(tweet, mediaSource, avatarImage, mediaBox) {
        const canvas = document.createElement('canvas');
        canvas.width = exportWidth(mediaBox, tweet);
        const context = canvas.getContext('2d');
        context.font = '30px Arial';
        const textLines = wrapTextRuns(context, tweet.text || '', canvas.width - 80);
        canvas.height = 148 + textLines.length * 43 + (mediaBox ? mediaBox.height : 0) + 80;
        drawTweetFrame(context, canvas, tweet, avatarImage, mediaSource, mediaBox);
        return canvas;
    }

    async function renderImageCanvas(tweet) {
        const item = tweet.media[selectedMedia];
        let avatarImage = null;
        if (tweet.avatar) {
            try { avatarImage = await loadImage(tweet.avatar); } catch (error) { console.warn('TweetCap could not load avatar', error); }
        }
        let mediaImage = null;
        if (item?.kind === 'image') {
            try { mediaImage = await loadImage(item.url); } catch (error) { console.warn('TweetCap could not load image', error); }
        }
        const mediaBox = mediaImage ? fitMedia(mediaImage, 1120, 620) : null;
        return createTweetCanvas(tweet, mediaImage, avatarImage, mediaBox);
    }

    async function renderPreviewCanvas(tweet) {
        const item = tweet.media[selectedMedia];
        if (item?.kind === 'video' || item?.kind === 'gif') {
            if (item.element && item.element.readyState >= 2 && item.element.currentSrc === item.url) {
                const nativeVideo = item.element;
                const nativeState = snapshotVideoState(nativeVideo);
                try {
                    await seekVideo(nativeVideo, 0);
                    const mediaBox = fitMedia(nativeVideo, 1120, 620);
                    const avatarImage = tweet.avatar ? await loadImage(tweet.avatar).catch(() => null) : null;
                    return createTweetCanvas(tweet, nativeVideo, avatarImage, mediaBox);
                } finally {
                    restoreVideoState(nativeVideo, nativeState);
                }
            }
            const [{ video, blobUrl, nativeState }, avatarImage] = await Promise.all([
                loadVideo(item.url, item.element),
                tweet.avatar ? loadImage(tweet.avatar).catch(() => null) : Promise.resolve(null)
            ]);
            try {
                await seekVideo(video, 0);
                const mediaBox = fitMedia(video, 1120, 620);
                return createTweetCanvas(tweet, video, avatarImage, mediaBox);
            } finally {
                if (!video.isConnected || video !== item.element) video.pause();
                else restoreVideoState(video, nativeState);
                if (blobUrl) URL.revokeObjectURL(blobUrl);
            }
        }
        return renderImageCanvas(tweet);
    }

    async function renderImage(tweet) {
        const canvas = await renderImageCanvas(tweet);
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function download(url, filename) {
        if (typeof GM_download === 'function') {
            GM_download({ url, name: filename, saveAs: true });
            return;
        }
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
    }

    function addMenuItem(menu) {
        if (!lastArticle || Date.now() - lastMoreClick > 2000 || menu.querySelector('[data-tweetcap-menu-item]')) return;
        const item = document.createElement('div');
        item.dataset.tweetcapMenuItem = 'true';
        item.setAttribute('role', 'menuitem');
        item.tabIndex = 0;
        item.textContent = MENU_LABEL;
        item.style.cssText = 'padding: 12px 16px; cursor: pointer; font-weight: 700;';
        const activate = event => {
            event.preventDefault();
            event.stopPropagation();
            const article = lastArticle;
            menu.remove();
            openTweetDialog(article);
        };
        item.addEventListener('click', activate);
        item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event); });
        menu.appendChild(item);
    }

    function observeMenus() {
        const observer = new MutationObserver(() => {
            document.querySelectorAll('[role="menu"]').forEach(addMenuItem);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener('click', event => {
        const moreButton = event.target.closest('article [aria-label="More"]');
        if (moreButton) {
            lastArticle = moreButton.closest('article');
            lastMoreClick = Date.now();
        }
    }, true);

    function start() {
        installStyle();
        observeMenus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();