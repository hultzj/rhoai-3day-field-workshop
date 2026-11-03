# Step videos

One video per exercise (`m<module>-ex<n>.mp4`), embedded under each exercise heading
(`video::<id>.mp4[]`, files in `content/modules/ROOT/assets/images/`). Each is recorded from a real run
of the workshop as the participant, in the console's Web Terminal (the full-page view, `/terminal`),
by pasting the guide's own click-to-run blocks from the built site. Captions and highlight boxes are
drawn into the page, waits are sped up (with a badge), setup is cut out, and no video is longer than
two minutes. Ported from the NeMo Guardrails Evaluation lab's recorder.

**A recording is a verification.** Every highlight names the guide's expected output; if it is not on
screen, the exercise fails and produces no video, and the module stops there. Re-recording an exercise
deletes its old video first, so a failed take cannot leave a stale one behind. Recording all modules
from a fresh install is the workshop's end-to-end test: `all` ends with the participant cleanup page,
checked the same way but without video, so **`all` deletes everything the labs built**.

## No credentials on camera

* The participant logs in once, before recording and off camera (`login.mjs`); recordings reuse that
  session. The session file is a credential: keep it outside the repository, mode 600.
* Every text that appears on any recorded page, and a sample of the screen every 250 ms, is checked
  against the participant's and kubeadmin's passwords, the session cookies, the MaaS database password
  (from Module 5 on), and token-, key- and private-key-shaped strings. A match discards that video.
* The guide never prints a token or a full API key: tokens appear only inside `$(...)`, keys only as
  their first ten characters.

## Record

From a fresh bootstrap (`make -C automation bootstrap`), with a cluster-admin `oc` login (the scan
reads the MaaS database Secret):

```bash
cd scripts/videos && npm install && npx playwright install chromium
npm --prefix ../.. run build                      # the recorder pastes blocks from the built guide
LAB_USER=<user> LAB_PASSWORD_FILE=<file> DOMAIN=apps.<cluster> node login.mjs <state.json>
LAB_USER=<user> DOMAIN=apps.<cluster> STATE=<state.json> LAB_PASSWORD_FILE=<file> KUBEADMIN_PASSWORD_FILE=<file> \
  node record.mjs all          # or: list | m3 m4 | m5 --from m5-ex3 | m5 --from m5-ex1 --to m5-ex1
```

Modules build on each other (Day 1's GPU stack, Day 2's MaaS); record them in order, or from a state
where the earlier modules have run. Re-record after any change to a step's commands or expected
results (`check-lab.sh` fails when an embedded video is missing). `LAB_USER` must be the user you
logged in as: steps that print your username expect it.

`npm test` checks the step definitions offline: the cleanup steps against a recorded walk of the
cleanup page (`fixtures/cleanup-walk.txt`), the evaluation gate, the username, the fail-closed
database-password scan and the stale-video removal.
