# Frontend Actions

- Checks if PR needs Frontend team review


### How to use
```
name: "Frontend Review"
on: [pull_request_review, pull_request]

jobs:
triage:
  name: Frontend Team Approval
  runs-on: ubuntu-latest
  steps:
  - uses: Rippling/git-actions-frontend@master
    with:
      org: "Rippling"
      review-team-slug: "frontend"
      repo-token: "${{ secrets.GITHUB_TOKEN }}"
      access-token: "${{ secrets.ACCESS_TOKEN_BK }}"
```
