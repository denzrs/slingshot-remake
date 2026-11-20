import { t } from '../../platform/i18n';
import {
  cleanTemplateName, deleteTemplate, loadTemplates, MAX_TEMPLATE_FILE_BYTES, MAX_TEMPLATE_NAME, parseTemplateFile, saveTemplate,
  templateFile, templateFileName, type TemplateError, type TournamentTemplate,
} from '../../data/tournamentTemplates';
import { h } from '../menu/menu';
import { button, iconButton, textInput } from '../lobby/widgets';
import type { ConfirmDialog } from './confirm';
import { stageName, STAGES } from './setup';
import { stageSummary } from './stage-summary';

const ICON_DOWNLOAD = '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>';
const ICON_TRASH = '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>';

/** A bracket of four teams read from left to right: two pairs, their winners, the final. */
const EMPTY_ART = '<svg viewBox="0 0 200 112" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<g><rect x="3" y="6" width="44" height="16" rx="3"/><rect x="3" y="34" width="44" height="16" rx="3"/>'
  + '<rect x="3" y="62" width="44" height="16" rx="3"/><rect x="3" y="90" width="44" height="16" rx="3"/></g>'
  + '<g opacity=".6"><path d="M47 14h10v28M47 42h10M57 28h10"/><path d="M47 70h10v28M47 98h10M57 84h10"/>'
  + '<path d="M115 28h10v56M115 84h10M125 56h10"/></g>'
  + '<g><rect x="67" y="20" width="48" height="16" rx="3"/><rect x="67" y="76" width="48" height="16" rx="3"/></g>'
  + '<g stroke="var(--t-gold, #ffad65)"><rect x="135" y="42" width="62" height="28" rx="4"/>'
  + '<path d="M166 49l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"/></g></svg>';

export const templateErrorText = (error: TemplateError): string => t(`tournament.templateError.${error}`);

/** The template as a file in the player's downloads. */
export function downloadTemplate(template: TournamentTemplate): void {
  const url = URL.createObjectURL(new Blob([templateFile(template)], { type: 'application/json' }));
  const link = h('a', { href: url, download: templateFileName(template.name) }) as HTMLAnchorElement;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A file the player picked, read and checked: its size before a byte is read, then everything in it. */
async function readTemplateFile(file: File): Promise<{ ok: true; template: TournamentTemplate } | { ok: false; message: string }> {
  if (file.size > MAX_TEMPLATE_FILE_BYTES) return { ok: false, message: templateErrorText('tooBig') };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: templateErrorText('notJson') };
  }
  const result = parseTemplateFile(text);
  if (!result.ok) return { ok: false, message: templateErrorText(result.error) };
  const saved = saveTemplate(result.template);
  return saved ? { ok: true, template: saved } : { ok: false, message: t('tournament.templateSaveFailed') };
}

/**
 * The saved templates, each with what its levels play, to make a tournament from, download or delete; and a way to upload one.
 * Every name and value is set as text: nothing from a template is ever read as markup.
 */
export function templateList(options: {
  use: (template: TournamentTemplate) => void;
  notify: (message: string) => void;
  confirm: ConfirmDialog;
}): { el: HTMLElement; upload: () => void } {
  const el = h('div.t-templates', null);
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: 'hidden' }) as HTMLInputElement;
  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked) return;
    void readTemplateFile(picked).then((result) => {
      options.notify(result.ok ? t('tournament.templateImported', { name: result.template.name }) : result.message);
      paint();
    });
  });
  const upload = () => file.click();

  const row = (template: TournamentTemplate) => {
    const use = button(t('tournament.createButton'), true);
    use.addEventListener('click', () => options.use(template));
    const download = iconButton(t('tournament.templateDownload'), ICON_DOWNLOAD);
    download.addEventListener('click', () => downloadTemplate(template));
    const remove = iconButton(t('tournament.templateDelete'), ICON_TRASH);
    remove.addEventListener('click', () => options.confirm.ask({
      title: t('tournament.templateDeleteTitle', { name: template.name }), text: t('tournament.templateDeleteText'),
      yes: t('tournament.delete'), no: t('tournament.stay'), danger: true,
    }, () => { deleteTemplate(template.id); paint(); }));
    // The first level played first, the final last, as the bracket reads.
    const levels = template.stages.map((stage, index) => ({ stage, index })).reverse();
    return h('article.t-template', null,
      h('header.t-template__head', null,
        h('strong.t-template__name', null, template.name),
        h('span.t-template__size', null, t('tournament.versus', { n: template.teamSize }))),
      h('div.t-template__levels', null, ...levels.map(({ stage, index }) =>
        h('div.t-setting.t-setting--stage', null, h('strong', null, stageName(index, STAGES)), stageSummary(stage)))),
      h('footer.t-template__actions', null, download, remove, use),
    );
  };

  /** Nothing saved yet: a small bracket, what to do about it, and the upload. */
  const empty = () => {
    const art = h('div.t-empty__art', { 'aria-hidden': 'true' });
    art.innerHTML = EMPTY_ART;
    return h('div.lobby__empty.t-empty', null, art, h('strong', null, t('tournament.noTemplatesTitle')));
  };

  const paint = () => {
    const templates = loadTemplates();
    el.replaceChildren(
      ...(templates.length ? templates.map(row) : [empty()]),
      file,
    );
  };
  paint();
  return { el, upload };
}

export interface NameDialog {
  el: HTMLElement;
  isOpen(): boolean;
  /** Asks for a name; `save` gets it cleaned, and only when it is not empty. */
  ask(suggested: string, save: (name: string) => void): void;
  close(): void;
}

/** The name to save a tournament's settings under, in the page's own dialog. */
export function nameDialog(): NameDialog {
  const name = textInput('', { maxLength: MAX_TEMPLATE_NAME, autocomplete: 'off', placeholder: t('tournament.templateName') });
  name.setAttribute('aria-label', t('tournament.templateName'));
  const no = button(t('tournament.stay'));
  const yes = button(t('tournament.save'), true);
  let onSave: ((name: string) => void) | null = null;
  const panel = h('section.t-editor.t-confirm', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tournament.saveTemplateTitle') },
    h('h3.t-editor__title', null, t('tournament.saveTemplateTitle')),
    h('p.t-confirm__text', null, t('tournament.saveTemplateText')),
    h('div.lobby__field', null, name),
    h('footer.t-editor__foot', null, no, yes));
  const el = h('div.t-editor-backdrop', { hidden: 'hidden' }, panel);
  const close = () => { el.hidden = true; onSave = null; };
  const submit = () => {
    const clean = cleanTemplateName(name.value);
    if (!clean) { name.focus(); return; }
    const run = onSave;
    close();
    run?.(clean);
  };
  const sync = () => { yes.disabled = !cleanTemplateName(name.value); };
  name.addEventListener('input', sync);
  name.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
  no.addEventListener('click', close);
  yes.addEventListener('click', submit);
  el.addEventListener('click', (event) => { if (event.target === el) close(); });
  return {
    el,
    isOpen: () => !el.hidden,
    ask: (suggested, save) => {
      name.value = cleanTemplateName(suggested);
      sync();
      onSave = save;
      el.hidden = false;
      name.focus();
      name.select();
    },
    close,
  };
}
