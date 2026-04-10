(function initAdminPage() {
  const homeButton = document.getElementById('admin-home-button');
  if (!homeButton) return;

  homeButton.addEventListener('click', () => {
    window.location.assign('/');
  });
}());
