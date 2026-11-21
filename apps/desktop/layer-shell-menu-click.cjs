function dispatchTrustedLayerShellMenuClick(event, menuId, index, closeMenu, sendSelection) {
  if (event?.isTrusted !== true || !Number.isSafeInteger(menuId) || !Number.isSafeInteger(index) || index < 0) {
    return false;
  }
  event.stopPropagation();
  closeMenu();
  sendSelection({ menuId, index });
  return true;
}

module.exports = { dispatchTrustedLayerShellMenuClick };
