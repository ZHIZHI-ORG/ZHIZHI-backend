import { VercelRequest, VercelResponse } from '@vercel/node';

const privacyPolicyHtml = `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>知之隐私政策</title>
  <style>
    :root { color: #233332; background: #f7f2e8; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
    body { margin: 0; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 22px 72px; line-height: 1.75; }
    h1, h2 { font-family: "Songti SC", "STSong", serif; font-weight: 600; }
    h1 { font-size: 34px; margin-bottom: 6px; }
    h2 { font-size: 21px; margin-top: 34px; }
    p, li { font-size: 16px; }
    .meta { color: #667270; font-size: 14px; }
    a { color: #0c6964; }
  </style>
</head>
<body>
<main>
  <h1>知之隐私政策</h1>
  <p class="meta">生效日期：2026 年 8 月 19 日</p>
  <p>知之重视你的隐私。本政策说明知之在提供账号、八字档案、个性化内容、会员与积分服务时处理哪些数据、为什么处理，以及你可以如何管理这些数据。</p>

  <h2>我们处理的数据</h2>
  <ul>
    <li>账号与认证信息：邮箱、登录标识、Apple 或 Google 登录返回的必要账号标识。</li>
    <li>你主动填写的资料：昵称、性别、出生日期、时间、地点、八字档案、MBTI、人生阶段、职业或学业场景、关系状态与当前目标。</li>
    <li>服务内容与互动：你查看或打开的内容、收藏、追问、反馈和生成任务状态。</li>
    <li>购买与权益信息：商品标识、Apple 交易标识、App Account Token、会员状态、积分余额与流水。我们不接收你的银行卡或 Apple ID 密码。</li>
    <li>必要的技术信息：请求时间、错误日志、服务版本及用于保障账号安全和排查故障的最少技术数据。</li>
  </ul>

  <h2>使用目的</h2>
  <p>这些数据用于创建和保护账号、生成及持续提供个性化内容、同步跨设备状态、恢复购买、处理退款或撤销、预防欺诈、保障服务稳定、回应支持请求，并在去标识或汇总后改进产品质量。</p>

  <h2>第三方服务</h2>
  <p>知之使用 Apple 提供登录与应用内购买能力，使用 Supabase 提供认证和数据库服务，使用 Vercel 提供后端托管，并可能使用 Google 登录与 Google Gemini 生成个性化内容。我们只向这些服务提供完成相应功能所需的数据，并要求其按照适用规则保护数据。用于生成内容的信息不包含你的账号密码或支付卡信息。</p>

  <h2>数据保存与安全</h2>
  <p>我们在提供服务和履行安全、交易及合规义务所需期间保存数据，并采取访问控制、传输加密、交易签名验证和账号隔离等措施。互联网服务无法保证绝对安全，我们会持续缩小数据范围并修复已知风险。</p>

  <h2>你的选择与权利</h2>
  <p>你可以在 App 内查看或修改个人资料。你可以在“我的 → 关于与帮助”中使用注销账号功能，请求删除账号及与账号直接关联的数据。部分交易、安全日志或备份可能在履行法定义务或完成系统轮转所需的有限期间内保留。</p>

  <h2>政策更新</h2>
  <p>当产品能力、第三方服务或适用规则发生变化时，我们会更新本政策，并在页面上标明新的生效日期。重大变化会通过 App 内适当方式提示。</p>

  <h2>联系我们</h2>
  <p>如对隐私、数据访问或删除有疑问，请通过 App 内“我的 → 关于与帮助”中的支持入口联系我们。</p>
</main>
</body>
</html>`;

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Method not allowed');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  return req.method === 'HEAD' ? res.status(200).send('') : res.status(200).send(privacyPolicyHtml);
}
