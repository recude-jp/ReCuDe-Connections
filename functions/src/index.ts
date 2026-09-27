import * as admin from 'firebase-admin';

admin.initializeApp();
// CandidateProfileInputなど任意フィールドをundefinedのままFirestoreへ書き込めるようにする。
admin.firestore().settings({ ignoreUndefinedProperties: true });

export { resolveMemberSession } from './resolveMemberSession';
export { getMyInviteQr, regenerateInviteQr, createInvite, getInvitePreview, joinAsGuest } from './invites';
export { createCommunity, updateCommunity, deleteCommunity } from './communities';
export {
  setCommunityAdmin,
  removeCommunityMember,
  decideCommunityApplication,
  updateCommunityProfile,
} from './communityMembers';
export { createStampPack, addCommunityStamp, updateStampPack } from './stampPacks';
export { applyForMembership, decideMembership } from './membership';
export { updateTenantBranding } from './updateTenantBranding';
export { updateProfileFields } from './updateProfileFields';
export { recomputeDerivedProfiles } from './recomputeDerivedProfiles';
export { updateMembershipTerms } from './updateMembershipTerms';
export { updateMyProfile } from './updateMyProfile';
export { setMemberRoles } from './setMemberRoles';
export { setMemberStatus } from './setMemberStatus';
export { sendConnectionRequest } from './sendConnectionRequest';
export { respondToConnectionRequest } from './respondToConnectionRequest';
export { createGroup, inviteToGroup, respondToGroupInvitation, setGroupAdmin, leaveGroup } from './groups';
export { onRoomMessageCreated } from './onRoomMessageCreated';
export { startPasskeyRegistration } from './startPasskeyRegistration';
export { completePasskeyRegistration } from './completePasskeyRegistration';
export { startPasskeyAuthentication } from './startPasskeyAuthentication';
export { completePasskeyAuthentication } from './completePasskeyAuthentication';
export { listPasskeyCredentials } from './listPasskeyCredentials';
export { deletePasskeyCredential } from './deletePasskeyCredential';
export { setupPin } from './setupPin';
export { pinSignIn } from './pinSignIn';
export { listPinDevices } from './listPinDevices';
export { removePinDevice } from './removePinDevice';
