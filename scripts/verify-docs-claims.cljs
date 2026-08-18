#!/usr/bin/env nbb
;; verify-docs-claims — re-derive every number README.md and docs/operator-quickstart.md
;; state, from the tree itself, and fail when the tree and the prose disagree.
;;
;; Before the cljs migration this file's load-bearing claim would have been a GAP:
;; the Worker that would be deployed was a SvelteKit build output
;; (svelte/.svelte-kit/cloudflare/_worker.js, not in the tree) while
;; worker/src/app.ts -- the 468-line file that read like the application -- was in
;; no bundle. That gap is closed, so the claims assert the CLOSURE, and they are
;; written so the gap cannot quietly come back: the TypeScript is asserted ABSENT
;; by name, not merely absent from a byte total.
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> FIRST, default ".")
;; Exit:   0 every claim holds · 1 a claim is false · 2 could not answer

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[cljs.reader :as reader]
         '[clojure.string :as str])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 35
   ;; the appview = everything that is not kotoba/ and not scripts/
   :appview-ts-files 0
   :appview-svelte-artifacts 0     ; no .svelte / svelte.config / svelte/ dir survives
   :appview-canonical-files 4      ; route.cljc view.cljc worker.cljs route_test.cljc
   :sveltekit-compat-flags 0       ; nodejs_compat was adapter-cloudflare's
   ;; kotoba/ is NOT the appview and the migration did not touch it. Pinned so it
   ;; cannot grow -- or shrink -- silently.
   :kotoba-files 7
   :kotoba-ts-files 5
   ;; declaration artifacts (bpmn/ dmn/ dodaf/ forms/). Pinned by COUNT only, not
   ;; by content: they are design artifacts a human may legitimately edit, and a
   ;; content pin would make honest edits look like tampering.
   :declaration-files 11
   :declared-vars 4
   :declared-routes 1
   :wrangler-main "../dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export "open-water.worker/handler"})

;; Identity / custody files this repository still carries BYTE-IDENTICAL.
;; worker/wrangler.jsonc and CLAUDE.md left this set deliberately -- both were
;; changed by the migration -- and are checked by CONTENT below instead of by hash,
;; so an intentional change and a stray change stay distinguishable.
(def preserved
  {"README.edn" "43d240f412ccb1a14f703ccf44f4a5f6d003214601bee67e46eebd560b6b13fb"
   "migration.edn" "879e85fa9ca1edd54891591bda7afdb9f4bfcfb0b5dba214c17cba31eb10a039"
   "worker/kotodama.jsonld" "b94921d78a52cd2361d5db975f500e5ada13ac751e0b19881c3f8f931c810140"
   ;; kotoba/ -- see :kotoba-files. Content-pinned because the claim README makes
   ;; about it is precisely "the migration did not touch it".
   "kotoba/package.json" "5ff9069f7972c6a8992e846251599f760e11fb04923993b2ed7631d3a47664be"
   "kotoba/src/index.ts" "dd7104242ff71a28ca2ac1bc14947b05a379a99c119625dc4caffd358cb5315a"
   "kotoba/src/registry.ts" "1c82d25927deaa3f4f5d14033ce2bef8e77dd14d022a4b9342a325e99251cc11"
   "kotoba/src/types.ts" "59b2363b7bd4a8cfdada4082e765b822781821b3f1571240954be2fda9c3df17"
   "kotoba/test/open-water.test.ts" "e06064c0056f7c1927f00ce8f13b22b8a7ae8fc1f56af95ea26c3216fd0ec69b"
   "kotoba/tsconfig.json" "95a429e51d6162cb7205b603f745e7604d93ffbb1ea6c346e5c6215a79ae541e"
   "kotoba/vitest.config.ts" "f82a551ef4da1c9cbf17985a3bee96eee450a3e4a46bff0d96c6150263121eff"})

;; What the migration REMOVED, by name. A byte total cannot say "the TypeScript is
;; gone"; this can, and it fails if any of it comes back.
(def removed-by-migration
  ["worker/src/app.ts"
   "worker/src/defence-handlers.ts"
   "worker/src/dodaf-bootstrap.ts"
   "worker/svelte/package.json"
   "worker/svelte/src/app.html"
   "worker/svelte/src/routes/+page.svelte"
   "worker/svelte/src/routes/xrpc/[...path]/+server.ts"
   "worker/svelte/svelte.config.js"
   "worker/svelte/tsconfig.json"
   "worker/svelte/vite.config.ts"])

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256") (.update (.readFileSync fs (str root "/" rel))) (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))
(defn appview? [f] (not (or (str/starts-with? f "kotoba/") (str/starts-with? f "scripts/"))))

(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; the appview's TypeScript and Svelte are gone, by name
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))

    ;; ... and gone under ANY name. The list above names the ten files; these catch
    ;; a return under a different one -- a new .svelte file, a svelte.config, a
    ;; svelte/ directory, or a .ts file anywhere in the appview.
    (check! :appview-svelte-artifacts (:appview-svelte-artifacts claims)
            (count (filter #(and (appview? %)
                                 (or (str/ends-with? % ".svelte")
                                     (str/includes? % "svelte.config")
                                     (str/includes? % "/svelte/")))
                           files)))
    (check! :appview-ts-files (:appview-ts-files claims)
            (count (filter #(and (appview? %) (str/ends-with? % ".ts")) files)))
    (check! :appview-canonical-files (:appview-canonical-files claims)
            (count (filter #(and (appview? %) (re-find #"\.(cljs|cljc|clj|kotoba)$" %)) files)))

    ;; kotoba/ is not the appview. It is in no bundle and referenced by nothing the
    ;; migration replaced, so it stayed. Pinned so "we left it alone" stays true.
    (check! :kotoba-files (:kotoba-files claims)
            (count (filter #(str/starts-with? % "kotoba/") files)))
    (check! :kotoba-ts-files (:kotoba-ts-files claims)
            (count (filter #(and (str/starts-with? % "kotoba/") (str/ends-with? % ".ts")) files)))
    (check! :declaration-files (:declaration-files claims)
            (count (filter #(re-find #"^(bpmn|dmn|dodaf|forms)/" %) files)))

    ;; CLAUDE.md no longer claims a TypeScript runtime it no longer has
    (let [c (slurp* "CLAUDE.md")]
      (if (nil? c)
        (undet! "CLAUDE.md unreadable")
        (check! :claude-md-describes-cljs true
                (and (not (str/includes? c "Single CF Worker (`src/app.ts`)"))
                     (str/includes? c "shadow-cljs")))))

    ;; the deployed bundle is built from the source in this tree
    (let [w (some-> (slurp* "worker/wrangler.jsonc") strip-jsonc)
          sh (slurp* "shadow-cljs.edn")]
      (if (or (nil? w) (nil? sh))
        (undet! "worker/wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          ;; the old config served a SvelteKit client dir that no longer exists
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :sveltekit-compat-flags (:sveltekit-compat-flags claims)
                  (count (filter #{"nodejs_compat" "nodejs_als"}
                                 (or (get j "compatibility_flags") []))))
          (check! :app-framework-not-sveltekit true
                  (not (str/includes? (str (get-in j ["vars" "APP_FRAMEWORK"])) "sveltekit")))
          (check! :shadow-builds-that-main true
                  (and (str/includes? sh (str ":output-dir \"" (:shadow-output-dir claims) "\""))
                       (str/includes? sh (:shadow-export claims))
                       (str/includes? (str (get j "main")) (str (:shadow-output-dir claims) "/worker.js"))))
          ;; ⚠ :warnings-as-errors is PARSED, not grepped. shadow reads
          ;; [:compiler-options :warnings-as-errors]; put under :build-options it is
          ;; silently ignored -- which is the same failure the option exists to
          ;; prevent. A grep cannot tell the two apart, and would also be satisfied
          ;; by the comment three lines above it in shadow-cljs.edn.
          (let [edn (try (reader/read-string sh) (catch :default e (undet! (str "shadow-cljs.edn is not readable EDN: " (.-message e))) nil))]
            (when edn
              (check! :warnings-as-errors-in-compiler-options true
                      (true? (get-in edn [:builds :worker :compiler-options :warnings-as-errors])))
              (check! :warnings-as-errors-not-misplaced true
                      (nil? (get-in edn [:builds :worker :build-options :warnings-as-errors]))))))))

    ;; The page renders the route TABLE rather than a baked count -- the defect
    ;; ADR-0001 recorded was a literal `routeCount: 0` and `vars: []` beside a
    ;; config declaring 1 route and 4 vars. Asserted structurally (the view takes
    ;; :routes, the worker passes the real table) and NOT by forbidding a substring:
    ;; a check that forbade "routeCount" anywhere would be tripped by the docstring
    ;; that explains the old defect. A check a comment can fail is a check about prose.
    (let [v (slurp* "src/open_water/view.cljc")
          w (slurp* "src/open_water/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-route-table true
                (and (str/includes? v "[{:keys [routes vars mcp-url built-at]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")))))

    ;; the ADR is EDN tx-data that actually reads
    (let [adr "docs/adr/0001-migrate-the-appview-from-typescript-to-clojurescript.edn"
          s (slurp* adr)]
      (if (nil? s)
        (undet! (str adr " unreadable"))
        (let [parsed (try (reader/read-string s) (catch :default e (undet! (str adr " is not readable EDN: " (.-message e))) nil))]
          (when parsed
            (check! :adr-is-tx-data true
                    (and (vector? parsed) (map? (first parsed))
                         (= "accepted" (:adr/status (first parsed)))
                         (string? (:adr/body (first parsed)))))))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f)))) (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds") (js/process.exit 0))))
