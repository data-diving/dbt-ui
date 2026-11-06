#!/usr/bin/env bash
# Creates the demo repositories under screenshots/.demo/git-repos (idempotent: skips existing ones).
#  - jaffle_shop_duckdb: dbt Labs' demo project, plus a prod target using env vars, the automate_dv
#    package and a mapping for MetaDV, and a data test that fails (for a failed run)
#  - analytics-platform: a repository with the same dbt project in a subdirectory (transform/)
# Job checkouts fetch the default branch from origin, so jaffle's origin (still shown as the GitHub
# URL) is redirected to a local bare copy that has the demo commit. All runs share one DuckDB file.
set -euo pipefail
cd "$(dirname "$0")"
REPOS=.demo/git-repos
mkdir -p "$REPOS"
export GIT_AUTHOR_NAME="Dana Analyst" GIT_AUTHOR_EMAIL="dana@example.com"
export GIT_COMMITTER_NAME="Dana Analyst" GIT_COMMITTER_EMAIL="dana@example.com"

IN_CONTAINER=/home/dbtui/git-repos
JAFFLE="$REPOS/jaffle_shop_duckdb"
JAFFLE_URL=https://github.com/dbt-labs/jaffle_shop_duckdb.git
mkdir -p "$REPOS/.warehouse"
if [ ! -d "$JAFFLE" ]; then
  git clone --quiet --single-branch "$JAFFLE_URL" "$JAFFLE"
  git -C "$JAFFLE" config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
  (
    cd "$JAFFLE"
    sed -i.bak -e "s#path: 'jaffle_shop.duckdb'#path: $IN_CONTAINER/.warehouse/jaffle_shop.duckdb#" -e 's/threads: 24/threads: 4/' profiles.yml && rm profiles.yml.bak
    cat >> profiles.yml <<'YML'
    prod:
      type: duckdb
      path: jaffle_shop_prod.duckdb
      threads: 4
      settings:
        s3_endpoint: "{{ env_var('DBT_HOST', 's3.amazonaws.com') }}"
        s3_access_key_id: "{{ env_var('DBT_USER', '') }}"
        s3_secret_access_key: "{{ env_var('DBT_PASSWORD', '') }}"
YML
    cat > packages.yml <<'YML'
packages:
  - package: Datavault-UK/automate_dv
    version: [">=0.11.0", "<0.12.0"]
YML
    # Committed, as dbt recommends (sha1_hash is of packages.yml above)
    cat > package-lock.yml <<'YML'
packages:
  - name: automate_dv
    package: Datavault-UK/automate_dv
    version: 0.11.5
  - name: dbt_utils
    package: dbt-labs/dbt_utils
    version: 1.4.1
sha1_hash: 2e43328992856367bc82841605dc102d48893344
YML
    mkdir -p macros tests
    cat > macros/automate_dv_duckdb.sql <<'SQL'
{#- automate_dv has no DuckDB support: use its Postgres versions of the macros dbt needs to parse -#}
{%- macro duckdb__get_escape_characters() -%}
    {%- do return(automate_dv.postgres__get_escape_characters(*varargs, **kwargs)) -%}
{%- endmacro -%}
{%- macro duckdb__cast_date() -%}
    {%- do return(automate_dv.postgres__cast_date(*varargs, **kwargs)) -%}
{%- endmacro -%}
{%- macro duckdb__cast_datetime() -%}
    {%- do return(automate_dv.postgres__cast_datetime(*varargs, **kwargs)) -%}
{%- endmacro -%}
SQL
    cat > tests/assert_orders_have_payments.sql <<'SQL'
-- Every order needs a payment
select order_id, amount
from {{ ref('orders') }}
where amount is null or amount <= 0
SQL
    mkdir -p models/metadv
    cat > models/metadv/metadv.yml <<'YML'
metadv:
  targets:
  - name: customer
    description: A person who placed at least one order
    type: entity
  - name: order
    description: An order in the web shop
    type: entity
  - name: customer_order
    type: relation
    entities: [customer, order]
  sources:
  - name: stg_customers
    columns:
    - name: customer_id
      target: [{target_name: customer}]
    - name: first_name
      target: [{attribute_of: customer}]
    - name: last_name
      target: [{attribute_of: customer}]
  - name: stg_orders
    columns:
    - name: order_id
      target: [{target_name: order}, {target_name: customer_order, entity_name: order}]
    - name: customer_id
      target: [{target_name: customer_order, entity_name: customer}]
    - name: order_date
      target: [{attribute_of: order}]
    - name: status
      target: [{attribute_of: order}]
  - name: stg_payments
    columns:
    - name: payment_id
    - name: order_id
      target: [{target_name: order}]
    - name: payment_method
      target: [{attribute_of: order, target_attribute: payment_method}]
    - name: amount
      target: [{attribute_of: order, target_attribute: payment_amount}]
YML
    git add -A
    git commit --quiet -m "Add prod target, automate_dv and payment check"
  )
  # Default branch "main" (upstream calls it "duckdb"), here and in the bare copy
  (
    cd "$JAFFLE"
    git branch --quiet -m main
    git update-ref refs/remotes/origin/main HEAD
    git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
    git update-ref -d refs/remotes/origin/duckdb
    git branch --quiet --set-upstream-to origin/main
  )
  git clone --quiet --bare "$JAFFLE" "$REPOS/.remotes/jaffle_shop_duckdb.git"
  git -C "$JAFFLE" config "url.$IN_CONTAINER/.remotes/jaffle_shop_duckdb.git.insteadOf" "$JAFFLE_URL"
fi

PLATFORM="$REPOS/analytics-platform"
if [ ! -d "$PLATFORM" ]; then
  mkdir -p "$PLATFORM"
  (
    cd "$PLATFORM"
    git init --quiet -b main
    mkdir transform
    git -C ../jaffle_shop_duckdb archive HEAD | tar -x -C transform
    printf '# Analytics platform\n\nThe dbt project is in transform/.\n' > README.md
    git add -A
    git commit --quiet -m "Initial analytics platform"
  )
fi
echo "Demo repositories ready in screenshots/$REPOS"
