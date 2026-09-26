/*!
 * FlowMember SDK — drop-in member management for Webflow sites.
 * Usage:
 *   <script src="https://YOUR-SERVER/sdk/flowmember.js"
 *           data-site-id="YOUR_PUBLIC_KEY"
 *           data-api="https://YOUR-SERVER"></script>
 *
 * Then anywhere in your Webflow page, use data attributes — no code needed:
 *
 *   <form data-ms-form="signup">
 *     <input type="email" name="email" required>
 *     <input type="password" name="password" required>
 *     <button type="submit">Sign up</button>
 *   </form>
 *
 *   <form data-ms-form="login">...</form>
 *   <a href="#" data-ms-logout>Log out</a>
 *
 *   <div data-ms-content="member">Only visible when logged in</div>
 *   <div data-ms-content="visitor">Only visible when logged out</div>
 *   <div data-ms-plan="pro">Only visible to members on the "pro" plan</div>
 *
 *   <span data-ms-bind="email"></span>   fills in the member's email
 *   <span data-ms-bind="plan"></span>    fills in the member's plan
 *
 *   <div data-ms-protected="premium-article" data-ms-fallback="upgrade-msg">
 *     (replaced with the real content from the server if the member's plan
 *     allows it — the text itself is never sent to the browser otherwise)
 *   </div>
 *   <div id="upgrade-msg" style="display:none">Upgrade to read this.</div>
 */
(function () {
  var scriptTag = document.currentScript;
  var siteId = scriptTag.getAttribute('data-site-id');
  // data-api is optional: if omitted (or left empty), default to the origin
  // the SDK script itself was loaded from.
  var apiAttr = scriptTag.getAttribute('data-api');
  var apiBase = (apiAttr && apiAttr.trim() ? apiAttr.trim() : new URL(scriptTag.src, window.location.href).origin).replace(/\/$/, '');

  if (!siteId) {
    console.error('[FlowMember] Missing data-site-id on the script tag.');
    return;
  }

  var TOKEN_KEY = 'fm_token_' + siteId;
  var MEMBER_KEY = 'fm_member_' + siteId;

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setSession(token, member) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
    } catch (e) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(MEMBER_KEY);
    } catch (e) {}
  }
  function getCachedMember() {
    try {
      var raw = localStorage.getItem(MEMBER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(apiBase + '/api/m/' + siteId + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  function showFormError(form, message) {
    var el = form.querySelector('[data-ms-error]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-ms-error', '');
      el.style.color = '#c0392b';
      el.style.marginTop = '8px';
      form.appendChild(el);
    }
    el.textContent = message;
  }

  function handleAuthForm(form, kind) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('[name="email"]');
      var password = form.querySelector('[name="password"]');
      if (!email || !password) {
        console.error('[FlowMember] Form needs name="email" and name="password" inputs.');
        return;
      }
      api('/' + kind, {
        method: 'POST',
        body: { email: email.value, password: password.value },
      })
        .then(function (data) {
          setSession(data.token, data.member);
          var redirect = form.getAttribute('data-ms-redirect');
          if (redirect) {
            window.location.href = redirect;
          } else {
            window.location.reload();
          }
        })
        .catch(function (err) {
          showFormError(form, err.message);
        });
    });
  }

  function handleLogout(el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      clearSession();
      var redirect = el.getAttribute('data-ms-redirect');
      window.location.href = redirect || window.location.pathname;
    });
  }

  function applyVisibility(member) {
    document.querySelectorAll('[data-ms-content]').forEach(function (el) {
      var kind = el.getAttribute('data-ms-content');
      var show = kind === 'member' ? !!member : kind === 'visitor' ? !member : true;
      el.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('[data-ms-plan]').forEach(function (el) {
      var required = el.getAttribute('data-ms-plan');
      var show = !!member && member.plan === required;
      el.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('[data-ms-bind]').forEach(function (el) {
      var field = el.getAttribute('data-ms-bind');
      el.textContent = member && member[field] != null ? member[field] : '';
    });
  }

  function applyProtectedContent() {
    document.querySelectorAll('[data-ms-protected]').forEach(function (el) {
      var key = el.getAttribute('data-ms-protected');
      var fallbackId = el.getAttribute('data-ms-fallback');
      api('/content/' + encodeURIComponent(key))
        .then(function (data) {
          el.innerHTML = data.body;
          el.style.display = '';
        })
        .catch(function () {
          el.style.display = 'none';
          if (fallbackId) {
            var fb = document.getElementById(fallbackId);
            if (fb) fb.style.display = '';
          }
        });
    });
  }

  function init() {
    document.querySelectorAll('[data-ms-form="signup"]').forEach(function (f) {
      handleAuthForm(f, 'signup');
    });
    document.querySelectorAll('[data-ms-form="login"]').forEach(function (f) {
      handleAuthForm(f, 'login');
    });
    document.querySelectorAll('[data-ms-logout]').forEach(handleLogout);

    var cached = getCachedMember();
    applyVisibility(cached);
    applyProtectedContent();

    // Re-validate the cached session against the server in the background,
    // so a revoked/expired token doesn't keep showing gated UI forever.
    if (getToken()) {
      api('/me')
        .then(function (data) {
          setSession(getToken(), data.member);
          applyVisibility(data.member);
        })
        .catch(function () {
          clearSession();
          applyVisibility(null);
        });
    }
  }

  // expose a tiny manual API too, for custom Webflow interactions/code
  window.FlowMember = {
    getMember: getCachedMember,
    isLoggedIn: function () { return !!getToken(); },
    logout: function () {
      clearSession();
      applyVisibility(null);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
