import { createPageShell } from './pages/shared.js';
import { createAlbumPage } from './pages/album.js';
import { createWarehousePage } from './pages/warehouse.js';
import { createShopPages } from './pages/shop.js';
import { createSettingsPage } from './pages/settings.js';
import { createDialogs } from './pages/dialogs.js';
export function createArchiveScreens(dependencies) {
  const context = { ...dependencies, ...createPageShell(dependencies) };
  return {
    album: createAlbumPage(context),
    warehouse: createWarehousePage(context),
    ...createShopPages(context),
    settings: createSettingsPage(context),
    ...createDialogs(context),
  };
}
