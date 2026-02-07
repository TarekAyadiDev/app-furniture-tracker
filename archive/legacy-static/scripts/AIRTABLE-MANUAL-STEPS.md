# Airtable table – manual steps after running setup

The script created all missing columns in the table used by `config.js`. Two things must be done in the Airtable UI (the API cannot do them):

## 1. Set Status options

The **Status** field already existed with different options. Set its options exactly to:

- `Idea`, `Shortlist`, `Selected`, `Ordered`, `Delivered`, `Installed`, `Returned`

In Airtable: click the Status column header → Customize field type → edit the options (remove old ones, add these seven).

## 2. Remove unused columns (optional)

The table still has columns that are not used by the app. You can delete them in the UI:

- **Listing URL** – first set another field as primary (e.g. **Title**): Table → Customize table → set primary field, then delete "Listing URL".
- **Your Comment**
- **Group**
- **Appointment Time**
- **Agent Notes**
- **Last Updated** (optional; system field)

Do not delete: Record Type, Title, Room, Status, Priority, Link, Notes, Budget Target, Price, Quantity, Selected Option Id, or any of the measurement/option/purchase columns.

## Verification

- Table has all required columns (37 total after script run).
- **Record Type** options are: `Measurement`, `Item`, `Option`, `Purchase`, `Note`.
- After step 1, **Status** options are: `Idea`, `Shortlist`, `Selected`, `Ordered`, `Delivered`, `Installed`, `Returned`.
