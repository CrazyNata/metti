(() => {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.classList.toggle('visible', visible);
      button.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
    });
  });
})();
