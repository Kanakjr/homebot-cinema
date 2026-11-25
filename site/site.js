// HomeBot Cinema website: menu, screenshot viewer, copy buttons, click-to-play video, story table of contents.
// Everything works without this file; it only adds comfort.
(function () {
    'use strict';

    // Header border once the page scrolls
    var header = document.querySelector('.site-header');
    if (header) {
        var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    // Mobile menu
    var toggle = document.querySelector('.menu-toggle');
    var nav = document.getElementById('site-nav');
    if (toggle && nav) {
        var setOpen = function (open) {
            toggle.setAttribute('aria-expanded', String(open));
            nav.classList.toggle('is-open', open);
        };
        toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
        nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    }

    // Copy buttons: data-copy points at the element whose text is copied
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var src = document.querySelector(btn.getAttribute('data-copy'));
            if (!src || !navigator.clipboard) return;
            navigator.clipboard.writeText(src.innerText.trim()).then(function () {
                btn.textContent = 'Copied';
                setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
            });
        });
    });

    // Demo video: the link opens YouTube; with JS it plays in place instead (privacy-enhanced domain).
    // The iframe needs a referrer: YouTube refuses embeds without one (error 153), and this page sets no-referrer.
    document.querySelectorAll('.video[data-youtube]').forEach(function (link) {
        link.addEventListener('click', function (e) {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            var id = encodeURIComponent(link.getAttribute('data-youtube'));
            var frame = document.createElement('iframe');
            frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1';
            frame.title = 'HomeBot Cinema demo video';
            frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
            frame.allowFullscreen = true;
            frame.referrerPolicy = 'strict-origin-when-cross-origin';
            var box = document.createElement('div');
            box.className = 'video';
            box.appendChild(frame);
            link.replaceWith(box);
        });
    });

    // Screenshot viewer
    var dialog = document.getElementById('lightbox');
    if (dialog && typeof dialog.showModal === 'function') {
        var img = dialog.querySelector('.lb-stage img');
        var caption = dialog.querySelector('.lb-caption');
        var group = [];
        var index = 0;
        var opener = null;

        var show = function (i) {
            index = (i + group.length) % group.length;
            var item = group[index];
            img.src = item.getAttribute('href');
            img.alt = (item.querySelector('img') || {}).alt || '';
            caption.textContent = '';
            var title = document.createElement('b');
            title.textContent = item.getAttribute('data-title') || '';
            caption.appendChild(title);
            var text = item.getAttribute('data-text');
            if (text) caption.appendChild(document.createTextNode('  ' + text));
            var many = group.length > 1;
            dialog.querySelector('.lb-prev').hidden = !many;
            dialog.querySelector('.lb-next').hidden = !many;
        };

        document.querySelectorAll('[data-lightbox]').forEach(function (link) {
            link.addEventListener('click', function (e) {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                var name = link.getAttribute('data-lightbox');
                group = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox="' + name + '"]'));
                opener = link;
                show(group.indexOf(link));
                dialog.showModal();
                document.documentElement.style.overflow = 'hidden';
            });
        });

        dialog.querySelector('.lb-close').addEventListener('click', function () { dialog.close(); });
        dialog.querySelector('.lb-prev').addEventListener('click', function () { show(index - 1); });
        dialog.querySelector('.lb-next').addEventListener('click', function () { show(index + 1); });
        dialog.addEventListener('click', function (e) {
            if (e.target === dialog || e.target.classList.contains('lb-stage')) dialog.close();
        });
        dialog.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') show(index - 1);
            if (e.key === 'ArrowRight') show(index + 1);
        });
        dialog.addEventListener('close', function () {
            document.documentElement.style.overflow = '';
            img.removeAttribute('src');
            if (opener) opener.focus();
        });
    }

    // Story page: highlight the chapter in view
    var tocLinks = document.querySelectorAll('.toc a[href^="#"]');
    if (tocLinks.length && 'IntersectionObserver' in window) {
        var byId = {};
        tocLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                tocLinks.forEach(function (a) { a.classList.remove('is-active'); });
                var a = byId[entry.target.id];
                if (a) a.classList.add('is-active');
            });
        }, { rootMargin: '-30% 0px -60% 0px' });
        Object.keys(byId).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) observer.observe(el);
        });
    }
})();
