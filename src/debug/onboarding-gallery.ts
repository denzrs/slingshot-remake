import '@fontsource/big-shoulders-stencil-display/800';
import './looks-gallery.css';
import './onboarding-gallery.css';
import { isLang, setLang, t } from '../platform/i18n';

const lang = new URLSearchParams(location.search).get('lang');
setLang(isLang(lang) ? lang : 'de');
document.documentElement.lang = isLang(lang) ? lang : 'de';
const language = document.documentElement.lang;
const root = document.createElement('main');
root.className = 'wrap onboarding-gallery';
const full = `/?preview=onboarding&lang=${language}`;
const training = `/?preview=onboarding-training&lang=${language}`;
root.innerHTML = `<header><h1>${t('dev.onboarding')}</h1><p class="note">${t('dev.onboarding.note')}</p>
  <nav><a href="${full}" target="_blank">${t('dev.onboarding.open')} ↗</a><a href="${training}" target="_blank">${t('dev.onboarding.training')} ↗</a></nav></header>
  <section><h2>Desktop <small>1280 × 800</small></h2><div class="onboarding-gallery__desktop"><iframe title="${t('dev.onboarding')} Desktop" src="${full}" width="1280" height="800"></iframe></div></section>
  <section><h2>Mobile <small>390 × 844</small></h2><div class="onboarding-gallery__mobile">
    <iframe title="${t('onboarding.graphics')} Mobile" src="${full}" width="390" height="844" loading="lazy"></iframe>
    <iframe title="${t('onboarding.training')} Mobile" src="${training}" width="390" height="844" loading="lazy"></iframe></div></section>`;
document.body.append(root);
