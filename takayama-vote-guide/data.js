/* =====================================================================
 * 高山市長選挙 投票マッチング — データ定義ファイル
 * ---------------------------------------------------------------------
 * このファイルだけを編集すれば、設問と候補者のデータを差し替えられます。
 *
 * 【重要・必ずお読みください】
 * 下記の候補者データは「サンプル（架空）」です。実在の候補者の主張を
 * 反映したものではありません。実際の選挙で利用する場合は、必ず
 *   ・選挙公報
 *   ・各候補者の公式サイト / 公約 / 公開討論会の発言 など
 * の一次情報にもとづいて CANDIDATES の内容を更新してください。
 * 出典が確認できない主張を候補者に紐づけて公開することは避けてください。
 * ===================================================================== */

/* 設問。各設問は「賛成(+2)〜反対(-2)」で答える形式です。
 * id: 一意のキー / text: 設問文 / category: 分類 / detail: 補足説明 */
const QUESTIONS = [
  {
    id: "tourism",
    category: "観光・産業",
    text: "観光（インバウンド誘致）への投資をこれまで以上に強化すべきだ。",
    detail: "古い町並みや飛騨高山ブランドを活かした観光振興に予算を重点配分する考え方です。",
  },
  {
    id: "residents_first",
    category: "観光・産業",
    text: "観光客向けの施策よりも、まず住民の生活環境(交通・物価・混雑対策)を優先すべきだ。",
    detail: "オーバーツーリズム対策や生活者目線の街づくりを重視する考え方です。",
  },
  {
    id: "depopulation",
    category: "人口・定住",
    text: "移住・定住promotionや若者の地元就職支援に積極的に予算を使うべきだ。",
    detail: "人口減少対策として、住宅支援・起業支援・UIターン支援などを進める考え方です。",
  },
  {
    id: "childcare",
    category: "子育て・教育",
    text: "子育て・教育support(保育料・医療費・給食費の無償化など)を、財政負担が増えても拡充すべきだ。",
    detail: "子育て世代の負担軽減を最優先する考え方です。",
  },
  {
    id: "welfare",
    category: "福祉・医療",
    text: "高齢者福祉や地域医療の維持・充実に重点的に取り組むべきだ。",
    detail: "高齢化が進む中で、医療・介護・交通弱者対策を厚くする考え方です。",
  },
  {
    id: "rural_balance",
    category: "地域バランス",
    text: "中心市街地よりも、合併した旧町村など周辺地域への予算配分を手厚くすべきだ。",
    detail: "広大な市域の周辺部(過疎地域)への配慮を重視する考え方です。",
  },
  {
    id: "snow_infra",
    category: "インフラ・防災",
    text: "除雪・道路・上下水道などの生活インフラ整備に最優先で予算を投じるべきだ。",
    detail: "豪雪地帯ならではの除雪体制やインフラ老朽化対策を重視する考え方です。",
  },
  {
    id: "disaster",
    category: "インフラ・防災",
    text: "地震・豪雨・土砂災害に備えた防災・減災investmentを大幅に増やすべきだ。",
    detail: "災害対策(避難所・治山治水・情報伝達など)を強化する考え方です。",
  },
  {
    id: "primary_industry",
    category: "農林業",
    text: "農業・林業など一次産業の振興と担い手育成に力を入れるべきだ。",
    detail: "飛騨牛・木材など地域資源を活かした一次産業支援を進める考え方です。",
  },
  {
    id: "environment",
    category: "環境・エネルギー",
    text: "再生可能エネルギーや脱炭素・自然環境保全に積極的に取り組むべきだ。",
    detail: "森林資源を活かした再エネや環境保全を重視する考え方です。",
  },
  {
    id: "fiscal_reform",
    category: "行財政",
    text: "公共施設の統廃合や事業見直しなど、行財政改革を優先して進めるべきだ。",
    detail: "将来の財政負担を抑えるため、歳出の見直しを重視する考え方です。",
  },
  {
    id: "digital",
    category: "行政・DX",
    text: "行政手続きのデジタル化・オンライン化を急いで進めるべきだ。",
    detail: "窓口のDXやオンライン申請の拡充で利便性を高める考え方です。",
  },
];

/* 候補者データ（★サンプル＝架空★）
 * stances: 各設問id に対する立場を -2〜+2 で指定
 *   +2: 強く賛成 / +1: やや賛成 / 0: 中立 / -1: やや反対 / -2: 強く反対
 * すべての設問に値を入れてください（未指定は中立0として扱われます）。*/
const CANDIDATES = [
  {
    id: "A",
    name: "候補者A（サンプル）",
    catchphrase: "観光と経済で稼ぐ、活力ある高山へ",
    color: "#d9534f",
    summary:
      "観光・産業振興を軸に、税収を増やして街を元気にする成長重視タイプ。インフラ投資にも前向き。",
    stances: {
      tourism: 2,
      residents_first: -1,
      depopulation: 1,
      childcare: 0,
      welfare: 0,
      rural_balance: -1,
      snow_infra: 1,
      disaster: 1,
      primary_industry: 1,
      environment: 0,
      fiscal_reform: 1,
      digital: 2,
    },
  },
  {
    id: "B",
    name: "候補者B（サンプル）",
    catchphrase: "暮らしファースト、子育て・福祉に手厚く",
    color: "#5cb85c",
    summary:
      "住民生活・子育て・福祉を最優先する生活者重視タイプ。観光より住民サービスの充実を掲げる。",
    stances: {
      tourism: -1,
      residents_first: 2,
      depopulation: 2,
      childcare: 2,
      welfare: 2,
      rural_balance: 1,
      snow_infra: 2,
      disaster: 1,
      primary_industry: 1,
      environment: 1,
      fiscal_reform: -1,
      digital: 1,
    },
  },
  {
    id: "C",
    name: "候補者C（サンプル）",
    catchphrase: "地域とともに、持続可能な高山を",
    color: "#428bca",
    summary:
      "周辺地域・一次産業・環境を重視するバランス・持続可能性タイプ。財政規律と地域分散を両立させる。",
    stances: {
      tourism: 0,
      residents_first: 1,
      depopulation: 1,
      childcare: 1,
      welfare: 1,
      rural_balance: 2,
      snow_infra: 1,
      disaster: 2,
      primary_industry: 2,
      environment: 2,
      fiscal_reform: 1,
      digital: 0,
    },
  },
];
