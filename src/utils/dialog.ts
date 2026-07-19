// 自製確認/提示對話框:瀏覽器原生 confirm/alert 在內嵌環境(iframe)
// 會被沙箱擋掉並靜默回傳取消,導致按鈕「按了沒反應」— 一律改用此模組。

function show(message: string, withCancel: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'app-dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'app-dialog';
    const text = document.createElement('p');
    text.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const done = (v: boolean) => {
      backdrop.remove();
      resolve(v);
    };
    if (withCancel) {
      const cancel = document.createElement('button');
      cancel.className = 'app-dialog-cancel';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => done(false));
      actions.appendChild(cancel);
    }
    const ok = document.createElement('button');
    ok.className = 'app-dialog-ok';
    ok.textContent = '確定';
    ok.addEventListener('click', () => done(true));
    actions.appendChild(ok);
    dialog.appendChild(text);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) done(false);
    });
    document.body.appendChild(backdrop);
    ok.focus();
  });
}

/** 取代 window.confirm(iframe 內也能用) */
export function appConfirm(message: string): Promise<boolean> {
  return show(message, true);
}

/** 取代 window.alert */
export function appAlert(message: string): Promise<void> {
  return show(message, false).then(() => undefined);
}
