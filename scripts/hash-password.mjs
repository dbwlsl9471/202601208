// 관리자 비밀번호를 ADMIN_PASSWORD_HASH 값으로 바꾼다: npm run hash-password
// 비밀번호 자체는 어디에도 저장하지 않는다. 출력된 값만 배포 설정(환경 변수)에 넣는다.
import { randomBytes, scryptSync } from 'node:crypto'
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
rl._writeToOutput = function (s) {
  if (s.includes('비밀번호')) process.stdout.write(s)
}
rl.question('새 관리자 비밀번호(12자 이상): ', (pw) => {
  rl.close()
  process.stdout.write('\n')
  if (!pw || pw.length < 12) {
    console.error('12자 이상으로 정해 주세요.')
    process.exit(1)
  }
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 32)
  console.log('\nADMIN_PASSWORD_HASH=' + ['scrypt', salt.toString('base64'), hash.toString('base64')].join(':'))
})
