import { Routes } from '@angular/router';
import { AdminService } from './core/services/admin.service';
import { AdminScopeService } from './core/services/admin-scope.service';
import { TenantBrandingService } from './core/services/tenant-branding.service';
import { adminEntryGuard, adminScopeGuard, rootScopeOnlyGuard } from './core/guards/admin.guard';

/**
 * 管理画面のルート(member.routes.ts から loadChildren で遅延ロードする)。
 * /admin/:scope/... の :scope は対象のコミュニティ(root = ルートコミュニティ、それ以外は連携コミュニティのID)。
 * 各画面は同じ部品のまま、AdminScopeService の対象について表示・操作する(連携コミュニティの一覧はルートだけ)。
 * Storage は会員エリア(member.routes.ts)で提供済み。
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    providers: [AdminService, AdminScopeService],
    children: [
      { path: '', pathMatch: 'full', canActivate: [adminEntryGuard], children: [] },
      {
        path: ':scope',
        canActivate: [adminScopeGuard],
        loadComponent: () => import('./features/admin-layout/admin-layout').then((m) => m.AdminLayout),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'members' },
          {
            path: 'members',
            loadComponent: () => import('./features/admin-members/admin-members').then((m) => m.AdminMembers),
          },
          {
            path: 'members/:memberId',
            loadComponent: () =>
              import('./features/admin-member-detail/admin-member-detail').then((m) => m.AdminMemberDetail),
          },
          {
            path: 'applications',
            loadComponent: () =>
              import('./features/admin-applications/admin-applications').then((m) => m.AdminApplications),
          },
          {
            path: 'profile-fields',
            loadComponent: () =>
              import('./features/admin-profile-fields/admin-profile-fields').then((m) => m.AdminProfileFields),
          },
          {
            path: 'membership-terms',
            loadComponent: () =>
              import('./features/admin-membership-terms/admin-membership-terms').then((m) => m.AdminMembershipTerms),
          },
          {
            path: 'communities',
            canActivate: [rootScopeOnlyGuard],
            loadComponent: () =>
              import('./features/admin-communities/admin-communities').then((m) => m.AdminCommunities),
          },
          {
            path: 'stamps',
            loadComponent: () => import('./features/admin-stamps/admin-stamps').then((m) => m.AdminStamps),
          },
          {
            path: 'settings',
            providers: [TenantBrandingService],
            loadComponent: () => import('./features/admin-settings/admin-settings').then((m) => m.AdminSettings),
          },
        ],
      },
    ],
  },
];
