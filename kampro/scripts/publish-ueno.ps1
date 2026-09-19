$ErrorActionPreference = 'Stop'
$root = 'C:\Users\ASUS\Documents\GitHub\OpenWA'
$target = 'root@206.189.206.119'
$sshOpts = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=25')

Write-Host '=== BACKUP + BEFORE ==='
ssh @sshOpts $target 'mkdir -p /opt/openwa/kampro/data/backups && cp -a /opt/openwa/kampro/data/kampro.sqlite /opt/openwa/kampro/data/backups/kampro.sqlite.pre-ueno-reimpute-20260913 && echo BACKUP_OK && sqlite3 /opt/openwa/kampro/data/kampro.sqlite "SELECT code, name, postable, role FROM Account ORDER BY code;" && echo BANCO_LINES && sqlite3 /opt/openwa/kampro/data/kampro.sqlite "SELECT count(*), ifnull(sum(debit),0), ifnull(sum(credit),0) FROM JournalLine WHERE accountId=(SELECT id FROM Account WHERE code=''1.1.02'');"'

Write-Host '=== COPY FILES ==='
scp @sshOpts "$root\kampro\src\domain\chart-of-accounts.ts" "${target}:/opt/openwa/kampro/src/domain/chart-of-accounts.ts"
scp @sshOpts "$root\kampro\src\services\accounts.service.ts" "${target}:/opt/openwa/kampro/src/services/accounts.service.ts"
scp @sshOpts "$root\kampro\src\services\journal.service.ts" "${target}:/opt/openwa/kampro/src/services/journal.service.ts"
scp @sshOpts "$root\kampro\scripts\reimpute-banco-ueno.ts" "${target}:/opt/openwa/kampro/scripts/reimpute-banco-ueno.ts"

Write-Host '=== RESTART KAMPRO ==='
ssh @sshOpts $target 'sed -i "s/\r$//" /opt/openwa/kampro/src/domain/chart-of-accounts.ts /opt/openwa/kampro/src/services/accounts.service.ts /opt/openwa/kampro/src/services/journal.service.ts /opt/openwa/kampro/scripts/reimpute-banco-ueno.ts && systemctl restart kampro && sleep 5 && systemctl is-active kampro && curl -sS http://127.0.0.1:3100/health && echo && echo ACCOUNTS_AFTER && sqlite3 /opt/openwa/kampro/data/kampro.sqlite "SELECT code, name, postable, role FROM Account ORDER BY code;" && echo BANK_LINES_AFTER && sqlite3 /opt/openwa/kampro/data/kampro.sqlite "SELECT a.code, a.name, a.postable, a.role, count(j.id), ifnull(sum(j.debit),0), ifnull(sum(j.credit),0) FROM Account a LEFT JOIN JournalLine j ON j.accountId=a.id WHERE a.code LIKE ''1.1.02%'' OR a.name LIKE ''%6193146823%'' OR a.name LIKE ''%6113146824%'' GROUP BY a.id ORDER BY a.code;"'

Write-Host '=== DONE ==='
