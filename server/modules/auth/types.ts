export type AuthUser = {
  userId: string;
  fullName: string;
  phone: string;
  role: string;
  status: string;
};

export type DeleteWindowCode = 'disabled' | 'same' | '1' | '3' | '7' | '15' | '30' | 'unlimited';
export type ModulePermission = { view: boolean; add: boolean; edit: boolean; delete: DeleteWindowCode | boolean; backdate?: DeleteWindowCode };
export type RolePermissions = Record<string, ModulePermission>;
