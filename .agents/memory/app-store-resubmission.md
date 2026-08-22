---
name: App Store rejection resubmission
description: How to resubmit an edited App Store version that is held by an unresolved review submission
---

**Rule:** When an App Store version is already part of a review submission in `UNRESOLVED_ISSUES`, do not create a new submission or try to delete the submitted item. Update the rejected review submission item with `resolved: true`, then set `submitted: true` on the original review submission.

**Why:** Apple keeps a rejected version attached to its original submitted item. Creating a new review item fails because the version is already part of another submission, and deleting the old item fails because it was already submitted.

**How to apply:** First finish metadata, screenshots, build selection, pricing, privacy labels, and review notes. Wait for uploaded assets to reach `COMPLETE`, mark the rejected item resolved, and resubmit the original submission. A successful transition ends at `WAITING_FOR_REVIEW`.