// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Aibi Soul Card · 测试网合约结构（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 当前阶段：仅作为「测试网合约结构」落地，不部署主网；
 * 链下由 MockChainProvider + chain_supply/chain_ledger 表模拟同一语义。
 *
 * 与链下模型的映射关系（双向对账基准）：
 *  - MAX_SUPPLY          ↔ chain_supply.max_supply（默认 100000）
 *  - totalMinted/Burned  ↔ chain_supply.total_minted / total_burned
 *  - nextTokenId()       ↔ chain_supply.next_token_id（单调递增，不复用）
 *  - certificateNo       ↔ soul_cards.certificate_no（AIBI-000001，tokenId 派生）
 *  - mint/burn 事件      ↔ chain_ledger 行（tx_hash / block_number / payload）
 *
 * 后续阶段预留（本阶段不实现，仅声明扩展点）：
 *  - 发币：AIBI ERC-20 + mint 奖励/手续费回流；
 *  - 交易：safeTransferFrom 已是 ERC-721 标准能力，需接版税（ERC-2981）；
 *  - 质押：ISoulCardStaking（按稀有度权重计息，见 RARITY_ORDER）；
 *  - 治理：DAO 提案（铸造参数/新物种发行）由代币持有者投票。
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract AibiSoulCard is ERC721, ERC721Enumerable, AccessControl {
    /// @notice MINTER_ROLE：平台服务端（ hot wallet ）专用，用户不可直接增发
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice 发行硬顶：链上稀缺性的唯一权威（对应 chain_supply.max_supply）
    uint256 public immutable MAX_SUPPLY;

    /// @notice 累计铸造数（含已销毁；tokenId 永不复用，保证凭证编号唯一性）
    uint256 public totalMinted;
    /// @notice 累计销毁数；流通量 = totalMinted - totalBurned
    uint256 public totalBurned;

    /// @notice 链上凭证编号（tokenId => "AIBI-000001"），mint 时固化
    mapping(uint256 => string) public certificateNoOf;

    /// @notice 链下业务状态根（可选）：soul_cards 行的 keccak256 摘要，用于链下数据篡改校验
    mapping(uint256 => bytes32) public soulStateHashOf;

    event SoulMinted(
        uint256 indexed tokenId,
        address indexed to,
        string certificateNo,
        string metadataURI
    );
    event SoulBurned(uint256 indexed tokenId, address indexed from);
    event SoulStateSynced(uint256 indexed tokenId, bytes32 stateHash);

    error SupplyExhausted();
    error NotTokenOwner();
    error EmptyCertificateNo();

    constructor(
        uint256 maxSupply_,
        string memory baseURI_
    ) ERC721("Aibi Soul Card", "AIBI") {
        require(maxSupply_ > 0, "maxSupply=0");
        MAX_SUPPLY = maxSupply_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _setBaseURI(baseURI_);
    }

    string private _baseTokenURI;

    function _setBaseURI(string memory uri_) internal {
        _baseTokenURI = uri_;
    }

    function setBaseURI(
        string memory uri_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setBaseURI(uri_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice 平台铸造：仅 MINTER_ROLE；受 MAX_SUPPLY 硬顶约束
    /// @param to 接收地址（用户钱包或平台托管地址）
    /// @param certificateNo 链下派生的凭证编号（"AIBI-000001"），不可为空
    function mint(
        address to,
        string calldata certificateNo
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (totalMinted >= MAX_SUPPLY) revert SupplyExhausted();
        if (bytes(certificateNo).length == 0) revert EmptyCertificateNo();
        tokenId = ++totalMinted; // tokenId 从 1 开始，与链下 next_token_id 对齐
        certificateNoOf[tokenId] = certificateNo;
        _safeMint(to, tokenId);
        emit SoulMinted(tokenId, to, certificateNo, tokenURI(tokenId));
    }

    /// @notice 销毁：仅持币人本人；销毁后流通量永久减少（对应链下 burn 语义）
    function burn(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        totalBurned += 1;
        _burn(tokenId);
        emit SoulBurned(tokenId, msg.sender);
    }

    /// @notice 链下状态摘要同步（运营/审计用，不阻断业务）
    function syncSoulState(
        uint256 tokenId,
        bytes32 stateHash
    ) external onlyRole(MINTER_ROLE) {
        soulStateHashOf[tokenId] = stateHash;
        emit SoulStateSynced(tokenId, stateHash);
    }

    /// @notice 流通量（对应链下 total_minted - total_burned）
    function circulatingSupply() external view returns (uint256) {
        return totalMinted - totalBurned;
    }

    // ---- 后续阶段扩展点（暂不实现）----
    // function stake(uint256 tokenId) external { /* Phase 3: 质押挖矿 */ }
    // function governanceVote(...) external { /* Phase 4: DAO 治理 */ }

    // ---- 必需的重写（ERC721Enumerable + AccessControl 多继承）----

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(
        address account,
        uint128 value
    ) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721, ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
