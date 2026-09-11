# Endpoint mapping

The uploaded collection contains **62 requests**. All are mapped below; 9 additional requests complete missing flows. The incomplete `/admin/:id/toggle` is supported as a plans alias. All original host prefixes are normalized to `/api`. Original IDs and credentials are removed from the new Postman collection.

| Request | Implemented endpoint | Access | Idempotency-Key | Source |
|---|---|---|---|---|
| plan / admin tongle plans | `PATCH /api/admin/:id/toggle` | Admin | — | Original |
| plan / get all plans | `GET /api/plans/admin` | Admin | — | Original |
| plan / create plan | `POST /api/plans/admin` | Admin | — | Original |
| plan / update plans | `PUT /api/plans/admin/:id` | Admin | — | Original |
| plan / delete plans | `DELETE /api/plans/admin/:id` | Admin | — | Original |
| plan / toggelPlan | `PATCH /api/plans/admin/:id/toggle` | Admin | — | Original |
| giftcode / get all gifts | `GET /api/gift-codes/admin` | Admin | — | Original |
| giftcode / create gifts | `POST /api/gift-codes/admin` | Admin | — | Original |
| giftcode / update gift code | `PUT /api/gift-codes/admin/:id` | Admin | — | Original |
| giftcode / delete gift code | `DELETE /api/gift-codes/admin/:id` | Admin | — | Original |
| giftcode / toggelGiftCodes | `PATCH /api/gift-codes/admin/:id/toggle` | Admin | — | Original |
| admin / Dashboard | `GET /api/admin/dashboard` | Admin | — | Original |
| admin / getUsers | `GET /api/admin/users` | Admin | — | Original |
| admin / getUserDetails | `GET /api/admin/users/:id` | Admin | — | Original |
| admin / Block | `PATCH /api/admin/users/:id/block` | Admin | — | Original |
| admin / unBlocked | `PATCH /api/admin/users/:id/unblock` | Admin | — | Original |
| admin / activeUser | `PATCH /api/admin/users/:id/activate` | Admin | — | Original |
| admin / deactivateUser | `PATCH /api/admin/users/:id/deactivate` | Admin | — | Original |
| auth / register | `POST /api/auth/register` | Public | — | Original |
| auth / sendOtp | `POST /api/auth/send-otp` | Public | — | Original |
| auth / verifyOtp | `POST /api/auth/verify-otp` | Public | — | Original |
| auth / getMe | `GET /api/auth/me` | User / admin | — | Original |
| auth / updateProfile | `PUT /api/auth/update-profile` | User / admin | — | Original |
| auth / verify_email | `GET /api/auth/verify-email/:token` | Public | — | Original |
| notification / getNotifications | `GET /api/notifications` | User / admin | — | Original |
| notification / getUnreadCount | `GET /api/notifications/unread-count` | User / admin | — | Original |
| notification / markAllRead | `PATCH /api/notifications/read-all` | User / admin | — | Original |
| notification / markRead | `PATCH /api/notifications/:id/read` | User / admin | — | Original |
| deposit / adminApproved | `PUT /api/deposits/admin/:id/approve` | Admin | Required | Original |
| deposit / adminReject | `PUT /api/deposits/admin/:id/reject` | Admin | Required | Original |
| deposit / userCreateDeposit | `POST /api/deposits` | User / admin | Required | Original |
| deposit / getAllDeposits | `GET /api/deposits/admin` | Admin | — | Original |
| deposit / getUserDeposit | `GET /api/deposits` | User / admin | — | Original |
| setings / getPublicSettings | `GET /api/app/settings` | Public | — | Original |
| setings / getPaymentMethod | `GET /api/payment-methods` | Public | — | Original |
| setings / getContacts | `GET /api/contacts` | Public | — | Original |
| setings / getSettings | `GET /api/admin/settings` | Admin | — | Original |
| setings / updateMentenance | `PUT /api/admin/settings/maintenance` | Admin | — | Original |
| setings / updateAppControll | `PUT /api/admin/settings/update-control` | Admin | — | Original |
| setings / updatePaymentMethods | `PUT /api/admin/settings/payment` | Admin | — | Original |
| setings / addContacts | `POST /api/admin/contacts` | Admin | — | Original |
| setings / updateContact | `PUT /api/admin/contacts/:id` | Admin | — | Original |
| setings / deleteContact | `DELETE /api/admin/contacts/:id` | Admin | — | Original |
| withdrawal / createWithdrawal | `POST /api/withdrawals` | User / admin | Required | Original |
| withdrawal / getUserWithdrawals | `GET /api/withdrawals` | User / admin | — | Original |
| withdrawal / getAllWithdrawals admin | `GET /api/withdrawals/admin` | Admin | — | Original |
| withdrawal / adminApproveWithdrawal | `PUT /api/withdrawals/admin/:id/approve` | Admin | Required | Original |
| withdrawal / rejectWithdrawal admin | `PUT /api/withdrawals/admin/:id/reject` | Admin | Required | Original |
| tasks / userGetTask | `GET /api/tasks` | User / admin | — | Original |
| tasks / userSubmitTask | `POST /api/tasks/:id/submit` | User / admin | Required | Original |
| tasks / getUserSubmissions | `GET /api/tasks/submissions` | User / admin | — | Original |
| tasks / createTask | `POST /api/tasks/admin` | Admin | — | Original |
| tasks / updateTask | `PUT /api/tasks/admin/:id` | Admin | — | Original |
| tasks / deleteTask | `DELETE /api/tasks/admin/:id` | Admin | — | Original |
| tasks / toggleTask | `PATCH /api/tasks/admin/:id/toggle` | Admin | — | Original |
| tasks / getAllSubmissions | `GET /api/tasks/admin/submissions` | Admin | — | Original |
| tasks / approveSubmission | `PUT /api/tasks/admin/submissions/:id/approve` | Admin | Required | Original |
| tasks / rejectSubmission | `PUT /api/tasks/admin/submissions/:id/reject` | Admin | Required | Original |
| tasks / adminGetAllTasks | `GET /api/tasks/admin` | Admin | — | Original |
| wallet / getTransactions | `GET /api/wallet/transactions` | User / admin | — | Original |
| wallet / adminAdjustWallet | `POST /api/wallet/admin/adjust` | Admin | Required | Original |
| wallet / getWallet | `GET /api/wallet` | User / admin | — | Original |
| auth / login | `POST /api/auth/login` | Public | — | Added |
| auth / logout | `POST /api/auth/logout` | User / admin | — | Added |
| auth / change password | `PUT /api/auth/password` | User / admin | — | Added |
| plan / list active plans | `GET /api/plans` | User / admin | — | Added |
| giftcode / redeem gift code | `POST /api/gift-codes/redeem` | User / admin | Required | Added |
| admin / audit log | `GET /api/admin/audit-logs` | Admin | — | Added |
| setings / admin list contacts | `GET /api/admin/contacts` | Admin | — | Added |
| setings / toggle contact | `PATCH /api/admin/contacts/:id/toggle` | Admin | — | Added |
| files / download proof | `GET /api/files/:id` | User / admin | — | Added |
