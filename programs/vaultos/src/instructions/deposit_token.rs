use crate::errors::VaultOSError;
use crate::events::DepositReceived;
use crate::state::Vault;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct DepositToken<'info> {
    pub vault: Account<'info, Vault>,

    /// CHECK: Vault authority account
    #[account(
        seeds = [b"vault_authority", vault.key().as_ref()],
        bump = vault.authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// CHECK: Validated in SPL transfer
    #[account(mut)]
    pub depositor_token_account: UncheckedAccount<'info>,

    /// CHECK: Validated in SPL transfer
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,

    /// CHECK: Token mint
    pub mint: UncheckedAccount<'info>,

    pub depositor: Signer<'info>,

    /// CHECK: SPL Token program
    pub token_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultOSError::InvalidTokenAccount);

    const SPL_TOKEN_ID: Pubkey = Pubkey::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
        237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
    ]);
    const SPL_TOKEN_2022_ID: Pubkey = Pubkey::new_from_array([
        6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252,
        77, 131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
    ]);
    require!(
        ctx.accounts.token_program.key == &SPL_TOKEN_ID
            || ctx.accounts.token_program.key == &SPL_TOKEN_2022_ID,
        VaultOSError::InvalidTokenAccount
    );

    // Verify vault_token_account is owned by token_program and belongs to vault_authority + mint
    require!(
        ctx.accounts.vault_token_account.owner == ctx.accounts.token_program.key
            && ctx.accounts.depositor_token_account.owner == ctx.accounts.token_program.key
            && ctx.accounts.mint.owner == ctx.accounts.token_program.key,
        VaultOSError::InvalidTokenAccount
    );
    let decimals: u8;
    {
        let vault_ta_data = ctx.accounts.vault_token_account.try_borrow_data()?;
        let dep_ta_data = ctx.accounts.depositor_token_account.try_borrow_data()?;
        let mint_data = ctx.accounts.mint.try_borrow_data()?;
        require!(
            vault_ta_data.len() >= 72 && dep_ta_data.len() >= 72 && mint_data.len() >= 45,
            VaultOSError::InvalidTokenAccount
        );
        require!(
            &vault_ta_data[0..32] == ctx.accounts.mint.key().as_ref()
                && &dep_ta_data[0..32] == ctx.accounts.mint.key().as_ref(),
            VaultOSError::InvalidTokenAccount
        );
        require!(
            &vault_ta_data[32..64] == ctx.accounts.vault_authority.key().as_ref(),
            VaultOSError::InvalidVaultAuthority
        );
        decimals = mint_data[44];
    }

    let clock = Clock::get()?;

    // SPL Token / Token-2022 instruction 12: TransferChecked (supports Token-2022 extensions)
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);

    let accounts = vec![
        AccountMeta::new(ctx.accounts.depositor_token_account.key(), false),
        AccountMeta::new_readonly(ctx.accounts.mint.key(), false),
        AccountMeta::new(ctx.accounts.vault_token_account.key(), false),
        AccountMeta::new_readonly(ctx.accounts.depositor.key(), true),
    ];

    let ix = Instruction {
        program_id: ctx.accounts.token_program.key(),
        accounts,
        data,
    };

    invoke(
        &ix,
        &[
            ctx.accounts.depositor_token_account.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.vault_token_account.to_account_info(),
            ctx.accounts.depositor.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
    )?;

    emit!(DepositReceived {
        vault: ctx.accounts.vault.key(),
        depositor: ctx.accounts.depositor.key(),
        mint: Some(ctx.accounts.mint.key()),
        amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
