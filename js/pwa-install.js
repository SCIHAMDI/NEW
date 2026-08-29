/* Al Ola Center - Universal PWA installation helper */
(function () {
  let deferredPrompt = null;
  const getButton = () => document.getElementById('installAppBtn') || document.getElementById('installPwaBtn');

  function isStandalone() {
    return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function ensureButton() {
    if (document.getElementById('installAppBtn') || document.getElementById('installPwaBtn')) return;
    const button = document.createElement('button');
    button.id = 'installPwaBtn';
    button.className = 'btn-pill hidden';
    button.type = 'button';
    button.textContent = '📲 تثبيت التطبيق';
    button.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.18);';
    document.body.appendChild(button);
  }

  function showInstallButton() {
    if (isStandalone()) return;
    const button = getButton();
    if (button) button.classList.remove('hidden');
  }

  async function install() {
    if (!deferredPrompt) {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (ios) {
        alert('لتثبيت التطبيق على iPhone/iPad: اضغط مشاركة ⬆️ ثم اختر "إضافة إلى الشاشة الرئيسية".');
      } else {
        alert('لو ظهر خيار "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية" في قائمة المتصفح، اختاره لتثبيت سنتر العلا.');
      }
      return;
    }
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    deferredPrompt = null;
    const button = getButton();
    if (button) button.classList.add('hidden');
    if (result.outcome === 'accepted' && typeof window.showToast === 'function') {
      window.showToast('تم تثبيت التطبيق بنجاح 📲', 'success');
    }
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    const button = getButton();
    if (button) button.classList.add('hidden');
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (isStandalone()) return;
    ensureButton();
    const button = getButton();
    if (button) button.addEventListener('click', install);
    // On iOS there is no beforeinstallprompt; keep a visible install button.
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) showInstallButton();
  });
})();
