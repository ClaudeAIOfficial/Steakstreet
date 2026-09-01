// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title StakeStreetVault
/// @notice Single-asset staking vault. Principal and rewards are paid in the same Robinhood Stock Token.
/// @dev Rewards are protocol-funded, not generated magically. The owner must fund rewardReserve.
contract StakeStreetVault {
    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;

    IERC20 public immutable asset;
    address public owner;
    uint256 public aprBps;
    uint256 public rewardReserve;
    uint256 public totalPrincipal;
    bool public paused;

    struct Position {
        uint256 principal;
        uint256 accrued;
        uint64 lastUpdated;
    }

    mapping(address => Position) public positions;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount);
    event AprUpdated(uint256 oldAprBps, uint256 newAprBps);
    event Paused(bool status);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    error Unauthorized();
    error InvalidAmount();
    error InsufficientPrincipal();
    error InsufficientRewardReserve();
    error TransferFailed();
    error ContractPaused();
    error InvalidApr();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address asset_, uint256 aprBps_, address owner_) {
        if (asset_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (aprBps_ > 5_000) revert InvalidApr(); // hard cap 50% APR
        asset = IERC20(asset_);
        aprBps = aprBps_;
        owner = owner_;
    }

    function principalOf(address user) external view returns (uint256) {
        return positions[user].principal;
    }

    function earned(address user) public view returns (uint256) {
        Position memory p = positions[user];
        if (p.lastUpdated == 0 || p.principal == 0) return p.accrued;
        uint256 elapsed = block.timestamp - uint256(p.lastUpdated);
        uint256 pending = (p.principal * aprBps * elapsed) / BPS / YEAR;
        return p.accrued + pending;
    }

    function stake(uint256 amount) external whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        _settle(msg.sender);
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        positions[msg.sender].principal += amount;
        totalPrincipal += amount;
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        _settle(msg.sender);
        Position storage p = positions[msg.sender];
        if (p.principal < amount) revert InsufficientPrincipal();
        p.principal -= amount;
        totalPrincipal -= amount;
        if (!asset.transfer(msg.sender, amount)) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function claim() external {
        _settle(msg.sender);
        Position storage p = positions[msg.sender];
        uint256 amount = p.accrued;
        if (amount == 0) revert InvalidAmount();
        if (rewardReserve < amount) revert InsufficientRewardReserve();
        p.accrued = 0;
        rewardReserve -= amount;
        if (!asset.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    function fundRewards(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (!asset.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        rewardReserve += amount;
        emit RewardsFunded(msg.sender, amount);
    }

    function setApr(uint256 newAprBps) external onlyOwner {
        if (newAprBps > 5_000) revert InvalidApr();
        uint256 old = aprBps;
        aprBps = newAprBps;
        emit AprUpdated(old, newAprBps);
    }

    function setPaused(bool status) external onlyOwner {
        paused = status;
        emit Paused(status);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    /// @notice Owner can recover only accidental excess tokens; principal and funded rewards remain protected.
    function recoverExcess(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = asset.balanceOf(address(this));
        uint256 protected = totalPrincipal + rewardReserve;
        if (balance < protected + amount) revert InvalidAmount();
        if (!asset.transfer(to, amount)) revert TransferFailed();
    }

    function _settle(address user) internal {
        Position storage p = positions[user];
        if (p.lastUpdated != 0 && p.principal != 0) {
            uint256 elapsed = block.timestamp - uint256(p.lastUpdated);
            p.accrued += (p.principal * aprBps * elapsed) / BPS / YEAR;
        }
        p.lastUpdated = uint64(block.timestamp);
    }
}
